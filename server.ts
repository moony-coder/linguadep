import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import crypto from "crypto";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { MOCKS } from "./src/data";

// Ensure env vars are loaded early (mainly for dev though Vite handles it, tsx might need dotenv)
dotenv.config();

// Sanitize raw inputs against potential prompt injections and bad characters
function sanitizeInput(val: string, maxLength: number): string {
  if (typeof val !== "string") return "";
  let clean = val.slice(0, maxLength);
  const dangerousPatterns = [
    /ignore prior instructions/gi,
    /ignore all previous/gi,
    /system instruction/gi,
    /override/gi,
    /you are now/gi,
    /act as/gi,
    /instead of/gi,
    /developer mode/gi
  ];
  for (const pattern of dangerousPatterns) {
    clean = clean.replace(pattern, " ");
  }
  clean = clean.replace(/[\r\n\t]/g, " ").trim();
  return clean;
}

// Mask sensitive environment keys in log files and console output
function maskSecrets(msg: string): string {
  if (!msg) return msg;
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey.length > 5) {
    const escaped = apiKey.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    msg = msg.replace(regex, "********");
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && botToken.length > 5) {
    const escaped = botToken.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    msg = msg.replace(regex, "********");
  }
  return msg;
}

if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL: GEMINI_API_KEY environment variable is missing.");
  process.exit(1);
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

class ExpiringMap<K, V> {
  private cache = new Map<K, { value: V; lastAccess: number }>();
  private ttl: number;
  private maxCapacity: number;
  private interval: NodeJS.Timeout;

  constructor(ttlMs: number, maxCapacity: number = 1000) {
    this.ttl = ttlMs;
    this.maxCapacity = maxCapacity;
    this.interval = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.cache.entries()) {
         if (now - record.lastAccess > this.ttl) {
            this.cache.delete(key);
         }
      }
    }, 5 * 60 * 1000);
    if (this.interval.unref) {
      this.interval.unref();
    }
  }

  get(key: K): V | undefined {
    const record = this.cache.get(key);
    if (!record) return undefined;
    const now = Date.now();
    if (now - record.lastAccess > this.ttl) {
       this.cache.delete(key);
       return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, { value: record.value, lastAccess: now });
    return record.value;
  }

  set(key: K, value: V): void {
    const now = Date.now();
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCapacity) {
      let oldestKey: K | null = null;
      let oldestAccess = Infinity;
      for (const [k, r] of this.cache.entries()) {
        if (r.lastAccess < oldestAccess) {
           oldestAccess = r.lastAccess;
           oldestKey = k;
        }
      }
      if (oldestKey !== null) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { value, lastAccess: now });
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }
}

const SERVER_SECRET = process.env.GEMINI_API_KEY || "lingua-bot-secure-session-fallback-secret-key-2026";

interface SessionData {
  mockId: string;
  userName: string;
  voiceChoice: string;
  part?: number;
  tier?: "free" | "casual" | "premium";
}

function generateSignedSessionToken(data: SessionData): string {
  const secureId = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes handshake TTL
  const payloadStr = Buffer.from(JSON.stringify(data)).toString("base64");
  const hash = crypto
    .createHmac("sha256", SERVER_SECRET)
    .update(`${secureId}.${expiresAt}.${payloadStr}`)
    .digest("hex");
  
  return `${secureId}.${expiresAt}.${payloadStr}.${hash}`;
}

function verifySignedSessionToken(token: string): SessionData | null {
  try {
     const [secureId, expiresAtStr, payloadStr, hash] = token.split(".");
     const expiresAt = parseInt(expiresAtStr);
     if (isNaN(expiresAt) || Date.now() > expiresAt) {
       return null;
     }
     const expectedHash = crypto
       .createHmac("sha256", SERVER_SECRET)
       .update(`${secureId}.${expiresAtStr}.${payloadStr}`)
       .digest("hex");
     if (hash !== expectedHash) {
       return null;
     }
     const decryptedJson = Buffer.from(payloadStr, "base64").toString("utf-8");
     return JSON.parse(decryptedJson);
  } catch {
     return null;
  }
}

const ipRequests = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 45;    // Max 45 requests per minute per IP

function rateLimitIP(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "unknown" || ip.slice(0, 7) === "10.244." || ip.slice(0, 3) === "10.") {
     return true;
  }
  const now = Date.now();
  const record = ipRequests.get(ip);
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
     ipRequests.set(ip, { count: 1, windowStart: now });
     return true;
  }
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
     return false;
  }
  record.count += 1;
  return true;
}

const tokenRequests = new Map<string, { count: number; windowStart: number }>();
const TOKEN_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_TOKENS_PER_WINDOW = 1000;             // Max 1000 tokens per hour per IP

function rateLimitTokenIP(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "unknown" || ip.slice(0, 7) === "10.244." || ip.slice(0, 3) === "10.") {
     return true;
  }
  const now = Date.now();
  const record = tokenRequests.get(ip);
  if (!record || now - record.windowStart > TOKEN_LIMIT_WINDOW_MS) {
     tokenRequests.set(ip, { count: 1, windowStart: now });
     return true;
  }
  if (record.count >= MAX_TOKENS_PER_WINDOW) {
     return false;
  }
  record.count += 1;
  return true;
}

interface ManagedKey {
  key: string;
  id: string;
  pool: "free" | "casual" | "premium" | "emergency";
  rpm: number;
  requests: number[];
  consecutiveErrors: number;
  status: "idle" | "active" | "errorBlocked" | "exhausted" | string;
  blockedUntil: number;
  assignedToUser: string | null;
  lastAssignedTime: number | null;
  totalRequests: number;
  totalSuccessfulRequests: number;
  totalFailedRequests: number;
}

class KeyPoolManager {
  private keys: ManagedKey[] = [];

  constructor() {
    this.initializeKeys();
  }

  private initializeKeys() {
    const MASTER_KEY = process.env.GEMINI_API_KEY || "AIzaSy_MOCK_GEMINI_API_KEY_FALLBACK";

    const FREE_KEYS_ENV = process.env.FREE_KEYS ? process.env.FREE_KEYS.split(",") : [];
    const CASUAL_KEYS_ENV = process.env.CASUAL_KEYS ? process.env.CASUAL_KEYS.split(",") : [];
    const PREMIUM_KEYS_ENV = process.env.PREMIUM_KEYS ? process.env.PREMIUM_KEYS.split(",") : [];
    const EMERGENCY_KEYS_ENV = process.env.EMERGENCY_KEYS ? process.env.EMERGENCY_KEYS.split(",") : [];

    const getMaskedId = (original: string, index: number, poolName: string): string => {
      if (original.startsWith("AIzaSy")) {
        const start = original.substring(0, 6);
        const end = original.substring(original.length - 4);
        return `${start}...${end} (${poolName.toUpperCase()} #${index})`;
      }
      return `${poolName.toUpperCase()}_KEY_${index}`;
    };

    // Free keys: index 1 to 3
    const freeRaw = FREE_KEYS_ENV.filter(Boolean).length > 0
      ? FREE_KEYS_ENV.map(k => k.trim())
      : Array.from({ length: 3 }, (_, i) => MASTER_KEY + `_free_${i + 1}`);
    freeRaw.forEach((k, idx) => {
      this.keys.push({
        key: k,
        id: k.includes("_free_") ? `Free_Key_Simulated_${idx + 1}` : getMaskedId(k, idx + 1, "free"),
        pool: "free",
        rpm: 0,
        requests: [],
        consecutiveErrors: 0,
        status: "idle",
        blockedUntil: 0,
        assignedToUser: null,
        lastAssignedTime: null,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0
      });
    });

    // Casual keys: index 1 to 10
    const casualRaw = CASUAL_KEYS_ENV.filter(Boolean).length > 0
      ? CASUAL_KEYS_ENV.map(k => k.trim())
      : Array.from({ length: 10 }, (_, i) => MASTER_KEY + `_casual_${i + 1}`);
    casualRaw.forEach((k, idx) => {
      this.keys.push({
        key: k,
        id: k.includes("_casual_") ? `Casual_Key_Simulated_${idx + 1}` : getMaskedId(k, idx + 1, "casual"),
        pool: "casual",
        rpm: 0,
        requests: [],
        consecutiveErrors: 0,
        status: "idle",
        blockedUntil: 0,
        assignedToUser: null,
        lastAssignedTime: null,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0
      });
    });

    // Premium keys: index 1 to 5
    const premiumRaw = PREMIUM_KEYS_ENV.filter(Boolean).length > 0
      ? PREMIUM_KEYS_ENV.map(k => k.trim())
      : Array.from({ length: 5 }, (_, i) => MASTER_KEY + `_premium_${i + 1}`);
    premiumRaw.forEach((k, idx) => {
      this.keys.push({
        key: k,
        id: k.includes("_premium_") ? `Premium_Key_Simulated_${idx + 1}` : getMaskedId(k, idx + 1, "premium"),
        pool: "premium",
        rpm: 0,
        requests: [],
        consecutiveErrors: 0,
        status: "idle",
        blockedUntil: 0,
        assignedToUser: null,
        lastAssignedTime: null,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0
      });
    });

    // Emergency keys: index 1 to 5
    const emergencyRaw = EMERGENCY_KEYS_ENV.filter(Boolean).length > 0
      ? EMERGENCY_KEYS_ENV.map(k => k.trim())
      : Array.from({ length: 5 }, (_, i) => MASTER_KEY + `_emergency_${i + 1}`);
    emergencyRaw.forEach((k, idx) => {
      this.keys.push({
        key: k,
        id: k.includes("_emergency_") ? `Emergency_Key_Simulated_${idx + 1}` : getMaskedId(k, idx + 1, "emergency"),
        pool: "emergency",
        rpm: 0,
        requests: [],
        consecutiveErrors: 0,
        status: "idle",
        blockedUntil: 0,
        assignedToUser: null,
        lastAssignedTime: null,
        totalRequests: 0,
        totalSuccessfulRequests: 0,
        totalFailedRequests: 0
      });
    });

    console.log(`[KeyPool] Initialized pooling with ${this.keys.length} keys total (${freeRaw.length} Free, ${casualRaw.length} Casual, ${premiumRaw.length} Premium, ${emergencyRaw.length} Emergency).`);
  }

  private cleanRequests(k: ManagedKey) {
    const now = Date.now();
    k.requests = k.requests.filter(t => now - t < 60000);
    k.rpm = k.requests.length;
    
    if (k.status !== "errorBlocked" && !k.status.startsWith("Circuit-Blocked")) {
      if (k.rpm >= 14) {
        k.status = "exhausted";
      } else if (k.rpm > 0) {
        k.status = "active";
      } else {
        k.status = "idle";
      }
    }
  }

  private getPremiumKeyForUser(userId: string): ManagedKey | null {
    const now = Date.now();

    // 1. Is there already a key assigned to this premium user?
    let assignedKey = this.keys.find(k => k.pool === "premium" && k.assignedToUser === userId);
    if (assignedKey) {
      assignedKey.lastAssignedTime = now;
      return assignedKey;
    }

    // 2. Garbage collect stale premium key slots (inactive > 15 mins)
    this.keys.forEach(k => {
      if (k.pool === "premium" && k.assignedToUser && k.lastAssignedTime && (now - k.lastAssignedTime > 15 * 60 * 1000)) {
        console.log(`[KeyPool] Recycled premium key ${k.id} from inactive user ${k.assignedToUser}`);
        k.assignedToUser = null;
        k.lastAssignedTime = null;
      }
    });

    // 3. Find an idle or unallocated premium key
    let availableKey = this.keys.find(k => k.pool === "premium" && !k.assignedToUser && k.status !== "errorBlocked" && k.consecutiveErrors < 3);
    if (availableKey) {
      availableKey.assignedToUser = userId;
      availableKey.lastAssignedTime = now;
      return availableKey;
    }

    return null; // Premium capacity maxed out
  }

  public releasePremiumKey(userId: string) {
    const keyObj = this.keys.find(k => k.pool === "premium" && k.assignedToUser === userId);
    if (keyObj) {
      console.log(`[KeyPool] Releasing premium key ${keyObj.id} back to pool for user ${userId}`);
      keyObj.assignedToUser = null;
      keyObj.lastAssignedTime = null;
    }
  }

  public acquireKey(user: string, poolType: "free" | "casual" | "premium"): ManagedKey {
    const now = Date.now();
    
    // Refresh blocked keys whose cooldown has expired
    this.keys.forEach(k => {
      if (k.status.startsWith("Circuit-Blocked") && now > k.blockedUntil) {
        k.status = "active";
        k.consecutiveErrors = 0;
      }
    });

    // 1) Premium logic (dedicated)
    if (poolType === "premium") {
      const pKey = this.getPremiumKeyForUser(user);
      if (pKey) {
        pKey.requests.push(now);
        pKey.totalRequests++;
        this.cleanRequests(pKey);
        pKey.status = "active";
        return pKey;
      }

      // If premium slots are maxed out, borrow first available emergency key
      const emergencyBorrow = this.keys.find(k => k.pool === "emergency" && !k.status.startsWith("Circuit-Blocked") && k.consecutiveErrors < 3 && k.requests.length < 14);
      if (emergencyBorrow) {
        console.log(`[KeyPool] Borrowing emergency key ${emergencyBorrow.id} for premium user ${user}`);
        emergencyBorrow.requests.push(now);
        emergencyBorrow.totalRequests++;
        this.cleanRequests(emergencyBorrow);
        emergencyBorrow.status = "active";
        return emergencyBorrow;
      }

      throw new Error("All premium slots are currently full. Please try again in 2 minutes.");
    }

    // 2) Free/Casual logic (rotation with RPM tracking)
    this.keys.forEach(k => this.cleanRequests(k));

    let candidates = this.keys.filter(k => k.pool === poolType && !k.status.startsWith("Circuit-Blocked") && k.consecutiveErrors < 3);
    candidates.sort((a, b) => a.requests.length - b.requests.length);

    if (candidates.length > 0 && candidates[0].requests.length < 14) {
      const selected = candidates[0];
      selected.requests.push(now);
      selected.totalRequests++;
      selected.status = "active";
      return selected;
    }

    // 3) Fallback to Emergency Pool if core pool is congested
    console.log(`[KeyPool] Core pool '${poolType}' exhausted or circuit-blocked. Falling back to Emergency Pool.`);
    let emergencies = this.keys.filter(k => k.pool === "emergency" && !k.status.startsWith("Circuit-Blocked") && k.consecutiveErrors < 3);
    emergencies.forEach(k => this.cleanRequests(k));
    emergencies.sort((a, b) => a.requests.length - b.requests.length);

    if (emergencies.length > 0 && emergencies[0].requests.length < 14) {
      const selected = emergencies[0];
      selected.requests.push(now);
      selected.totalRequests++;
      selected.status = "active";
      return selected;
    }

    throw new Error("All slots are busy right now. Please wait a moment for the pool quota to reset.");
  }

  public recordSuccess(keyId: string) {
    const k = this.keys.find(x => x.id === keyId);
    if (k) {
      k.consecutiveErrors = 0;
      k.totalSuccessfulRequests++;
      if (k.status.startsWith("Circuit-Blocked")) {
        k.status = k.requests.length >= 14 ? "exhausted" : "active";
      }
    }
  }

  public recordError(keyId: string, err: any) {
    const k = this.keys.find(x => x.id === keyId);
    if (k) {
      k.consecutiveErrors++;
      k.totalFailedRequests++;
      console.error(`[KeyPool] Key ${k.id} logged error:`, err?.message || String(err));
      
      if (k.consecutiveErrors >= 3) {
        k.status = "errorBlocked";
        k.blockedUntil = Date.now() + 2 * 60 * 1000; // 2 min block
        console.error(`[KeyPool] Circuit breaker triggered! Key ${k.id} blocked for 2 minutes.`);
      }
    }
  }

  public getRealKeyString(managedKey: ManagedKey): string {
    const rawValue = managedKey.key;
    if (
      rawValue.includes("_free_") ||
      rawValue.includes("_casual_") ||
      rawValue.includes("_premium_") ||
      rawValue.includes("_emergency_")
    ) {
      return process.env.GEMINI_API_KEY || "AIzaSy_FALLBACK";
    }
    return rawValue;
  }

  public getClient(keyStringOrKeyObj: any): GoogleGenAI {
    const rawKey = typeof keyStringOrKeyObj === "string" 
      ? keyStringOrKeyObj 
      : this.getRealKeyString(keyStringOrKeyObj);
    
    return new GoogleGenAI({
      apiKey: rawKey,
      httpOptions: {
        headers: {
          'User-Agent': 'LinguaBot/1.0',
        }
      }
    });
  }

  public getAdminStatus(): any[] {
    const now = Date.now();
    this.keys.forEach(k => this.cleanRequests(k));
    return this.keys.map(k => {
      let displayStatus = k.status;
      if (k.status === "errorBlocked" || k.consecutiveErrors >= 3) {
        const remainingSec = Math.max(0, Math.ceil((k.blockedUntil - now) / 1000));
        displayStatus = remainingSec > 0 ? `Circuit-Blocked (${remainingSec}s)` : "errorBlocked";
      }
      return {
        id: k.id,
        pool: k.pool,
        rpm: k.rpm,
        limit: 15,
        consecutiveErrors: k.consecutiveErrors,
        status: displayStatus,
        assignedToUser: k.assignedToUser,
        totalRequests: k.totalRequests,
        totalSuccessfulRequests: k.totalSuccessfulRequests,
        totalFailedRequests: k.totalFailedRequests,
        modelUsed: k.pool === "premium" ? "gemini-3.1-pro-preview" : "gemini-3.5-flash"
      };
    });
  }
}

const keyPoolManager = new KeyPoolManager();
const isServerlessRuntime = process.env.VERCEL === "1" || process.env.VERCEL === "true";

function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || "";
  return raw
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
}

// Initialize Google Gen AI
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "MISSING_KEY",
  httpOptions: {
    headers: {
      'User-Agent': 'LinguaBot/1.0',
    }
  }
});
const webChats = new ExpiringMap<string, ReturnType<typeof ai.chats.create>>(30 * 60 * 1000, 1000);
const sessionAudioBuffers = new Map<string, Buffer[]>();

// Setup Telegram Bot
const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").replace(/^["']|["']$/g, "").trim();
let bot: Telegraf | null = null;
const botChats = new ExpiringMap<number, any>(1 * 60 * 60 * 1000); // 1 hour TTL

// Initialize Server-Side Supabase Client (For account linking and transaction syncs)
const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/^["']|["']$/g, "").trim();
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || "").replace(/^["']|["']$/g, "").trim();
const isServerSupabaseConfigured = supabaseUrl !== "" && supabaseAnonKey !== "" && !supabaseUrl.includes("PLACEHOLD");
const serverSupabase = isServerSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

interface TelegramUserState {
  lastMessageTime: number;
  messageCount: number;
  windowStart: number;
}
const telegramUsers = new Map<number, TelegramUserState>();

function isTelegramThrottled(userId: number): boolean {
  const now = Date.now();
  const state = telegramUsers.get(userId);
  if (!state) {
    telegramUsers.set(userId, {
      lastMessageTime: now,
      messageCount: 1,
      windowStart: now,
    });
    return false;
  }
  
  // Throttle if sent within 1.5 seconds of each other
  if (now - state.lastMessageTime < 1500) {
    state.lastMessageTime = now;
    return true;
  }
  
  if (now - state.windowStart > 60000) {
    state.windowStart = now;
    state.messageCount = 1;
  } else {
    state.messageCount++;
    if (state.messageCount > 15) {
      state.lastMessageTime = now;
      return true;
    }
  }
  
  state.lastMessageTime = now;
  return false;
}

if (BOT_TOKEN && !isServerlessRuntime) {
  bot = new Telegraf(BOT_TOKEN);
  
  bot.start(async (ctx) => {
    const payload = ctx.startPayload;
    if (payload && serverSupabase) {
      const telegramId = String(ctx.from.id);
      try {
        await ctx.sendChatAction('typing');
        
        // Let's connect this telegram ID with the registered web candidate profile ID
        const { data: existingUser, error: checkErr } = await serverSupabase
          .from("users")
          .select("id, email, mocks_remaining")
          .eq("id", payload)
          .maybeSingle();

        if (checkErr) {
          throw new Error(`Failed to query user record: ${checkErr.message || JSON.stringify(checkErr)}. Please make sure to create the required tables by copying the SQL code from your Web App's Auth Portal.`);
        }

        if (!existingUser) {
          // Create the user row on the fly
          const { error: upsertErr } = await serverSupabase
            .from("users")
            .upsert({
              id: payload,
              telegram_id: telegramId,
              tier: "free",
              mocks_remaining: 2,
              updated_at: new Date().toISOString()
            });
          
          if (upsertErr) {
            throw new Error(`Failed to create user record: ${upsertErr.message || JSON.stringify(upsertErr)}. Ensure the "users" table is properly configured in the database.`);
          }
        } else {
          // Link telegram ID to existing row
          const { error: updateErr } = await serverSupabase
            .from("users")
            .update({
              telegram_id: telegramId,
              updated_at: new Date().toISOString()
            })
            .eq("id", payload);

          if (updateErr) {
            throw new Error(`Failed to link Telegram profile: ${updateErr.message || JSON.stringify(updateErr)}.`);
          }
        }

        await ctx.reply(`🎯 *Connection Successful!* \n\nHello, *${ctx.from.first_name || "Candidate"}*!\n\nYour Telegram profile has been linked securely with web account:\n\`${payload}\`\n\nYou can now buy mock practice session tokens! Type /buy to see active Stars packages.`, { parse_mode: "Markdown" });
      } catch (err: any) {
        console.error("Link Telegram payload error:", err);
        await ctx.reply(`⚠️ *Database Integration Error:*\n\n${err.message || "Something went wrong"}`, { parse_mode: "Markdown" });
      }
    } else {
      ctx.reply(`👋 Welcome to *LinguaBot practice portal*!\n\nTo lock down your IELTS credentials and buy mock tokens using Telegram Stars:\n1. Log into your Web Dashboard\n2. Click 'Connect Telegram' under Pricing Plans\n3. Click the integration redirect.\n\nYou can also practice languages here right now by typing or sending voice notes! Let's prep together!`, { parse_mode: "Markdown" });
    }
  });

  // Purchase packages catalog
  bot.command('buy', async (ctx) => {
    const telegramId = String(ctx.from.id);
    if (!serverSupabase) {
      await ctx.reply("⚠️ The platform is currently operating in guest mode. Account connection features are pending configuration.");
      return;
    }

    try {
      const { data: userRecord, error } = await serverSupabase
        .from("users")
        .select("id, mocks_remaining")
        .eq("telegram_id", telegramId)
        .maybeSingle();

      if (error) {
        await ctx.reply(`⚠️ *Database Error Querying Account:*\n\n\`${error.message || JSON.stringify(error)}\`\n\nPlease ensure your database tables are created. Copy and execute the SQL script from your web dashboard.`, { parse_mode: "Markdown" });
        return;
      }

      if (!userRecord) {
        await ctx.reply("❌ *Telegram Account Not Linked*\n\nYou must link your active Web Candidate account before purchasing plans!\n\n1. Open the IELTS Speaking Web App\n2. Click 'Connect Telegram' inside the Pricing Plans panel\n3. Complete the link redirection.\n\nOnce connected, type /buy here to buy packs!", { parse_mode: "Markdown" });
        return;
      }

      await ctx.reply(`✨ *Premium Practice Packages:* \n\nYour current candidate web balance: 🪙 *${userRecord.mocks_remaining ?? 0} Mocks*\n\nChoose an option below to buy instantly with Telegram Stars:`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🪙 3 Mocks (100 Stars)", callback_data: `buy_3_${userRecord.id}` }],
            [{ text: "🪙 10 Mocks (350 Stars)", callback_data: `buy_10_${userRecord.id}` }],
            [{ text: "🪙 20 Mocks (700 Stars)", callback_data: `buy_20_${userRecord.id}` }]
          ]
        }
      });
    } catch (err: any) {
      console.error("Fetch plans /buy error:", err);
      await ctx.reply(`Failed to load mock packages catalogs: ${err.message || "database connection error"}`);
    }
  });

  // Handle Stars Invoice Selection
  bot.on('callback_query', async (ctx: any) => {
    const data = ctx.callbackQuery?.data || "";
    if (data.startsWith("buy_")) {
      const parts = data.split("_");
      const count = parseInt(parts[1], 10) || 3;
      const supabaseUserId = parts.slice(2).join("_");

      let starPrice = 100;
      if (count === 10) starPrice = 350;
      if (count === 20) starPrice = 700;

      try {
        await ctx.answerCbQuery();
        
        const chatId = ctx.from?.id || ctx.chat?.id;
        if (!chatId) {
          throw new Error("Chat or Sender identifier not resolvable.");
        }

        await ctx.telegram.sendInvoice(
          chatId,
          {
            title: `🪙 IELTS ${count} practice credits`,
            description: `Diagnostic evaluations, lexical resource helper grids, full transcript archives, and scoring bands powered by Gemini 3.5.`,
            payload: JSON.stringify({ userId: supabaseUserId, count }),
            currency: "XTR",
            prices: [{ label: `${count} Credits`, amount: starPrice }],
            start_parameter: "linguabot-stars"
          }
        );
      } catch (invoiceErr: any) {
        console.error("Generate Star Invoice failure:", invoiceErr);
        await ctx.reply(`⚠️ Invoice failed to compile: ${invoiceErr.message || "Please make sure Stars payments are active in your bot configurations settings."}`);
      }
    }
  });

  // Handle Stars Gateway checkout verification
  bot.on('pre_checkout_query', async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (e: any) {
      console.error("PreCheckout error:", e);
      try {
        await ctx.answerPreCheckoutQuery(false, "Verification error, please try again.");
      } catch {}
    }
  });

  // Handle Checkout success, replay check, and automatic credits update
  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message?.successful_payment;
    if (!payment) {
      console.error("payment payload parsed null!");
      return;
    }

    const telegramChargeId = payment.telegram_payment_charge_id;
    if (!telegramChargeId) {
      console.error("payment charge id null or undefined!");
      return;
    }

    if (!serverSupabase) {
      console.error("Supabase server offline during checkout event receipt.");
      await ctx.reply("⚠️ Fatal processing error: DB link is disabled. Please contact Support with your payment ID.");
      return;
    }

    try {
      const payload = JSON.parse(payment.invoice_payload || "{}");
      const supabaseUserId = payload.userId;
      const count = parseInt(payload.count, 10) || 3;

      if (!supabaseUserId) {
        throw new Error("Missing link candidate uuid.");
      }

      // Replay Attack Protection
      const { data: existingPayment } = await serverSupabase
        .from("payments")
        .select("id")
        .eq("telegram_charge_id", telegramChargeId)
        .maybeSingle();

      if (existingPayment) {
        console.warn(`[REPLAY PREVENTION] chargeID ${telegramChargeId} was already processed.`);
        await ctx.reply("ℹ️ This transaction has already been credited to your candidate account!");
        return;
      }

      // Save trace reference to payments table
      const { error: insertErr } = await serverSupabase
        .from("payments")
        .insert({
          id: crypto.randomUUID(),
          telegram_charge_id: telegramChargeId,
          user_id: supabaseUserId,
          stars_paid: payment.total_amount,
          mocks_credited: count,
          created_at: new Date().toISOString()
        });

      if (insertErr) {
        console.error("Reference payment insert failure:", insertErr);
      }

      // Read then add balance
      const { data: userProfile } = await serverSupabase
        .from("users")
        .select("mocks_remaining")
        .eq("id", supabaseUserId)
        .maybeSingle();

      const existingBalance = userProfile?.mocks_remaining || 0;
      const finalBalance = existingBalance + count;

      // Update Database Entry
      const { error: updateErr } = await serverSupabase
        .from("users")
        .update({
          mocks_remaining: finalBalance,
          updated_at: new Date().toISOString()
        })
        .eq("id", supabaseUserId);

      if (updateErr) {
        throw updateErr;
      }

      await ctx.reply(`🎉 *Payment Confirmed!* \n\nCharged *${payment.total_amount} Telegram Stars*\nSuccessfully added *+${count} IELTS practice credits* directly to your profile.\n\nYour new candidate web balance: 🪙 *${finalBalance} Credits*\n\nHead back to the web portal to start practicing! Double mock tests unlocked.`, { parse_mode: "Markdown" });

    } catch (payErr: any) {
      console.error("Internal billing processor crashed:", payErr);
      await ctx.reply(`⚠️ Account upgrade error: ${payErr.message || "Database update failed"}. Please provide your transaction details to human support.`);
    }
  });

  bot.on(message('text'), async (ctx) => {
    const chatId = ctx.from.id;
    if (isTelegramThrottled(chatId)) {
      await ctx.reply("⚠️ Slow down. Please wait before sending another message.");
      return;
    }

    let chat = botChats.get(chatId);
    
    if (!chat) {
      chat = ai.chats.create({
        model: "gemini-3.5-flash",
        config: {
          systemInstruction: "You are a helpful language learning practice partner. The user is practicing a new language. Keep your responses conversational, natural, and correct their grammar gently if they make obvious mistakes. Respond primarily in the language they are practicing, with concise English translations or tips only if they struggle. Format responses with Markdown when appropriate.",
        }
      });
      botChats.set(chatId, chat);
    }

    try {
      await ctx.sendChatAction('typing');
      const currentApiKey = process.env.GEMINI_API_KEY;
      if (!currentApiKey) {
         await ctx.reply("System: GEMINI_API_KEY is not configured.");
         return;
      }
      const response = await chat.sendMessage({ message: ctx.message.text });
      await ctx.reply(response.text || "...", { parse_mode: 'Markdown' });
    } catch (e: any) {
      console.error("Bot Error:", maskSecrets(e.message || String(e)));
      await ctx.reply(`Sorry, I encountered an error: ${maskSecrets(e.message || "Something went wrong")}`);
    }
  });

  bot.on(message('voice'), async (ctx) => {
    const chatId = ctx.from.id;
    if (isTelegramThrottled(chatId)) {
      await ctx.reply("⚠️ Slow down. Please wait before sending another message.");
      return;
    }

    let chat = botChats.get(chatId);
    
    if (!chat) {
      chat = ai.chats.create({
        model: "gemini-3.5-flash",
        config: {
          systemInstruction: "You are a helpful language learning practice partner. The user is practicing a new language. Keep your responses conversational, natural, and correct their grammar gently if they make obvious mistakes. Respond primarily in the language they are practicing, with concise English translations or tips only if they struggle.",
        }
      });
      botChats.set(chatId, chat);
    }

    try {
      await ctx.sendChatAction('record_voice');
      const currentApiKey = process.env.GEMINI_API_KEY;
      if (!currentApiKey) {
         await ctx.reply("System: GEMINI_API_KEY is not configured.");
         return;
      }
      const fileId = ctx.message.voice.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const fileRes = await fetch(fileLink.href);
      const arrayBuffer = await fileRes.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      console.log("Processing voice message from Telegram...");
      const response = await chat.sendMessage({ 
         message: [{
            inlineData: { mimeType: "audio/ogg", data: base64Audio }
         }]
      });
      
      const responseText = response.text || "...";
      await ctx.sendChatAction('record_voice');

      // Generate TTS reply
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: responseText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
          },
        },
      });
      
      const audioData = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) {
         const audioBuffer = Buffer.from(audioData, 'base64');
         try {
             // Convert raw PCM to OGG Opus using ffmpeg-static for native Telegram voice messages
             const oggBuffer = await new Promise<Buffer>((resolve, reject) => {
                 if (!ffmpegStatic) return reject(new Error("ffmpeg not found"));
                 const ffmpegProcess = spawn(ffmpegStatic, [
                   '-f', 's16le',
                   '-ar', '24000',
                   '-ac', '1',
                   '-i', 'pipe:0',
                   '-c:a', 'libopus',
                   '-b:a', '32k',
                   '-f', 'ogg',
                   'pipe:1'
                 ]);
                 const chunks: Buffer[] = [];
                 let stderrOutput = '';
                 ffmpegProcess.stdout.on('data', (c: Buffer) => chunks.push(c));
                 ffmpegProcess.stderr.on('data', (c: Buffer) => { stderrOutput += c.toString(); });
                 ffmpegProcess.on('close', (code: number) => {
                    if (code === 0) resolve(Buffer.concat(chunks));
                    else reject(new Error('ffmpeg failed with code ' + code + ' | ' + stderrOutput));
                 });
                 // Handle errors to prevent crash
                 ffmpegProcess.on('error', (err) => reject(err));
                 // Write input buffer
                 ffmpegProcess.stdin.write(audioBuffer);
                 ffmpegProcess.stdin.end();
             });
             
             await ctx.replyWithVoice({ source: oggBuffer });
             
         } catch (conversionErr) {
             console.error("FFmpeg transcode error, falling back to audio document:", conversionErr);
             await ctx.replyWithDocument({ source: audioBuffer, filename: 'voice.pcm' });
         }
      } else {
         await ctx.reply(responseText, { parse_mode: 'Markdown' });
      }
    } catch (e: any) {
      console.error("Bot Voice Error:", maskSecrets(e.message || String(e)));
      await ctx.reply(`Sorry, I encountered an error answering your voice message: ${maskSecrets(e.message || "Something went wrong")}`);
    }
  });

  bot.command('reset', (ctx) => {
    botChats.delete(ctx.from.id);
    ctx.reply("Conversation history reset. What language would you like to practice now?");
  });

  bot.launch().catch(err => {
    console.error("Failed to launch Telegram bot:", err);
  });

  // Enable graceful stop
  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
  console.log("Telegram Bot initialized!");
} else if (BOT_TOKEN) {
  console.log("Telegram bot startup skipped in Vercel serverless runtime.");
} else {
  console.log("No TELEGRAM_BOT_TOKEN provided. Telegram bot is disabled.");
}

// Setup Express Web Server
interface AppOptions {
  includeViteMiddleware?: boolean;
  includeStaticFrontend?: boolean;
}

export async function createApp(options: AppOptions = {}) {
  const { includeViteMiddleware = false, includeStaticFrontend = false } = options;
  const app = express();
  const allowedOrigins = getAllowedOrigins();

  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    }
  }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "media-src": ["'self'", "blob:", "https://*"],
        "connect-src": ["'self'", "wss:", "https:", "http:"],
        "frame-ancestors": ["'self'", "https://*.google.com", "https://*.run.app", "https://ai.studio", "https://*.studio"],
      }
    },
    frameguard: false,
  }));

  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "microphone=(self)");
    next();
  });

  app.use(express.json({ limit: "64kb" }));

  // Liveness / Readiness health-check endpoint for container environment
  app.get(["/healthz", "/api/healthz"], (_, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Dynamic bot configuration info extraction endpoint
  app.get("/api/bot-info", async (_, res) => {
    try {
      if (bot) {
        const info = await bot.telegram.getMe();
        res.json({
          username: info.username || "speakpayment_bot",
          name: info.first_name || "LinguaBot",
          isActive: true
        });
      } else {
        res.json({
          username: "speakpayment_bot",
          name: "LinguaBot",
          isActive: false
        });
      }
    } catch (err: any) {
      console.error("Failed to fetch Telegram bot info:", err);
      res.json({
        username: "speakpayment_bot",
        name: "LinguaBot",
        isActive: false
      });
    }
  });

  // Global Rate Limiting Middleware for Express API Paths using standard express-rate-limit
  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // Limit each IP to 20 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again soon." },
    keyGenerator: (req) => {
      const xff = req.headers["x-forwarded-for"];
      if (typeof xff === "string") return xff.split(",")[0].trim();
      return req.socket.remoteAddress || "unknown";
    }
  });

  const sessionLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Limit each IP to 5 sessions per 5 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many test sessions started. Please wait 5 minutes before trying again." },
    keyGenerator: (req) => {
      const xff = req.headers["x-forwarded-for"];
      if (typeof xff === "string") return xff.split(",")[0].trim();
      return req.socket.remoteAddress || "unknown";
    }
  });

  app.use("/api/", apiLimiter);

  // Analytics tracking structure
  interface ClientActivity {
    clientId: string;
    userName?: string;
    ip: string;
    lastSeen: number;
    path: string;
    action: string;
  }
  const activeClients = new Map<string, ClientActivity>();
  let totalConnectionsToday = 0;
  let lastResetDate = new Date().toDateString();

  function trackClientActivity(req: any, clientId: string, userName: string, path: string, action: string) {
    if (!clientId) return;
    const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const currentDate = new Date().toDateString();
    if (lastResetDate !== currentDate) {
      totalConnectionsToday = 0;
      lastResetDate = currentDate;
    }
    
    // If it's a new client today, increment connection counter
    if (!activeClients.has(clientId)) {
      totalConnectionsToday++;
    }

    activeClients.set(clientId, {
      clientId,
      userName: userName || "Anonymous",
      ip,
      lastSeen: Date.now(),
      path,
      action
    });
  }

  // Periodic cleanup of stale clients (inactive for > 5 minutes)
  setInterval(() => {
    const now = Date.now();
    for (const [clientId, activity] of activeClients.entries()) {
      if (now - activity.lastSeen > 5 * 60 * 1000) {
        activeClients.delete(clientId);
      }
    }
  }, 60 * 1000);

  app.post("/api/ping", (req, res) => {
    const { clientId, userName, path, action } = req.body;
    trackClientActivity(req, clientId, userName || "Unknown", path || "/", action || "idle");
    res.json({ ok: true });
  });

  app.get("/api/admin/metrics", (req, res) => {
    // Collect stats
    const now = Date.now();
    const users = Array.from(activeClients.values()).map(c => ({
      ...c,
      inactiveTimeSeconds: Math.floor((now - c.lastSeen) / 1000)
    }));
    
    res.json({
      activeUsersCount: users.length,
      totalConnectionsToday,
      users: users.sort((a, b) => a.inactiveTimeSeconds - b.inactiveTimeSeconds),
      keys: keyPoolManager.getAdminStatus()
    });
  });

  function createWavHeader(numSamples: number, sampleRate: number = 16000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = numSamples * blockAlign;
    const chunkSize = 36 + dataSize;
    const header = Buffer.alloc(44);

    header.write("RIFF", 0);
    header.writeUInt32LE(chunkSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // Raw PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return header;
  }

  // Every 15 minutes, clean up buffers older than 45 minutes
  setInterval(() => {
    const now = Date.now();
    for (const token of sessionAudioBuffers.keys()) {
       try {
          const parts = token.split(".");
          if (parts.length >= 2) {
             const expiresAt = parseInt(parts[1]);
             if (!isNaN(expiresAt) && now > expiresAt + 15 * 60 * 1000) { // expired + 15 mins safety padding
                sessionAudioBuffers.delete(token);
                console.log("[CLEANUP] Pruned expired/stale session audio buffer from memory.");
             }
          } else {
             sessionAudioBuffers.delete(token);
          }
       } catch (e) {
          sessionAudioBuffers.delete(token);
       }
    }
  }, 15 * 60 * 1000);

  // Secure session route for Live WS connection
  app.post("/api/session", sessionLimiter, (req, res) => {
     let { mockId, userName, voiceChoice, part, tier } = req.body;
     if (!mockId || !userName || !voiceChoice) {
        res.status(400).json({ error: "Missing required session parameters: mockId, userName, and voiceChoice are required" });
        return;
     }

     // Sanitize variables to prevent any prompt injection risks and enforce maximum lengths
     mockId = sanitizeInput(mockId, 50);
     userName = sanitizeInput(userName, 60);
     voiceChoice = sanitizeInput(voiceChoice, 30);
     let parsedPart = part ? parseFloat(String(part)) : 1;
     if (isNaN(parsedPart)) parsedPart = 1;

     let userTier = tier;
     if (userTier !== "free" && userTier !== "casual" && userTier !== "premium") {
        userTier = "free";
     }

     if (!mockId || !userName || !voiceChoice) {
        res.status(400).json({ error: "Invalid session configuration parameters." });
        return;
     }

     const token = generateSignedSessionToken({ mockId, userName, voiceChoice, part: parsedPart, tier: userTier as any });
     const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0].trim();
     console.log(`[BILLING] Issued live session token to IP: ${ip} at ${new Date().toISOString()} (Tier: ${userTier})`);
     res.json({ token });
  });

  // Score analysis endpoint utilizing key pooling
  app.post("/api/score", async (req, res) => {
    console.log("API /api/score called.");

    const { token, conversationLog, mockTitle, part2Topic, pronunciationFeatures } = req.body;
    if (!conversationLog || !Array.isArray(conversationLog)) {
       res.status(400).json({ error: "Missing or invalid conversationLog" });
       return;
    }

    let userTier: "free" | "casual" | "premium" = "free";
    let userName = "Candidate";
    if (token) {
       const sessionData = verifySignedSessionToken(token);
       if (sessionData) {
          userTier = sessionData.tier || "free";
          userName = sessionData.userName || "Candidate";
       }
    }

    let selectedKeyObj: ManagedKey;
    try {
       selectedKeyObj = keyPoolManager.acquireKey(userName, userTier);
    } catch (poolErr: any) {
       res.status(429).json({ error: poolErr.message || "Key pooling congestion or limit exceeded error." });
       return;
    }

    const userAi = keyPoolManager.getClient(selectedKeyObj);

    let wavFileBase64: string | null = null;
    if (token) {
       const chunks = sessionAudioBuffers.get(token);
       if (chunks && chunks.length > 0) {
          try {
             const rawBuffer = Buffer.concat(chunks);
             const wavHeader = createWavHeader(rawBuffer.length / 2, 16000, 1, 16);
             const wavFileBuffer = Buffer.concat([wavHeader, rawBuffer]);
             wavFileBase64 = wavFileBuffer.toString("base64");
             console.log(`[SCORING] Successfully formed wav file from ${chunks.length} chunks. Size: ${wavFileBuffer.length} bytes.`);
             // Clean up the memory buffer since we are scoring it right now!
             sessionAudioBuffers.delete(token);
          } catch (wavErr) {
             console.error("Failed to build WAV wrapper from PCM chunks:", wavErr);
          }
       } else {
          console.log(`[SCORING] No voice chunks found for token in sessionAudioBuffers.`);
       }
    } else {
       console.log("[SCORING] No token present in scoring request.");
    }

    try {
       const transcriptText = conversationLog
         .map((entry: any) => `${entry.role.toUpperCase()} (Stage: ${entry.stage || 'unknown'}): ${entry.text}`)
         .join("\n");

       let prompt = `You are an official academic IELTS Speaking Examiner.
Analyze the following transcript of an entire IELTS Speaking practice session, and evaluate the candidate across the 4 standard IELTS Speaking criteria strictly matching the official IELTS Speaking Band Descriptors.

CRITICAL ASSESSMENT GUIDANCE matching Official IELTS Band Descriptors (Bands 1 to 9):

1. FLUENCY AND COHERENCE (FC):
   - Band 9: Speaks fluently with rare repetitions or self-corrections; hesitations are content-searching, not language-searching. Fully extended and coherent topics.
   - Band 8: Speaks fluently with occasional repetition or self-correction; hesitation is content-related. Structured, coherent, and relevant topic development.
   - Band 7: Produces long turns readily without noticeable effort; some hesitation, repetition, or self-correction mid-sentence indicating language retrieval struggles, but does not affect overall coherence. Uses appropriate connectives & discourse markers flexibly.
   - Band 6: Willing to speak at length but may lose coherence occasionally due to repetition, self-correction, or hesitation. Uses a range of markers/connectives although not always appropriately.
   - Band 5: Produces simple speech fluently, but complex speech causes noticeable disfluency. Relies heavily on slow delivery, repetition, self-correction, or basic vocabulary search. Overuses certain simple markers/connectives.
   - Band 4: Unable to keep going without noticeable pauses. Speech is slow with frequent repetition/self-correction. Severe breakdowns in coherence. Simple sentence connection.
   - Band 3: Frequent, sometimes long pauses occur while candidate searches for words. Limited ability to link simple sentences. Frequently unable to convey a basic message.
   - Band 2: Lengthy pauses before nearly every word. Isolated words may be recognisable but speech is of virtually no communicative significance.
   - Band 1: Speech is totally incoherent with no connection. Essentially none.

🚨 RIGOR CHECK: If the candidate keyboard-smashed, inputted random gibberish or garbage characters like "a a d k2n", "he", or said disconnected unrelated phonemes that are not proper English sentences answering the prompt, you MUST assign a score of 1.0 or 2.0. Do NOT award 7.0 or 8.0 for gibberish and incoherent attempts under any circumstances. You must evaluate coherence and actual relevance to the exam questions.

2. LEXICAL RESOURCE (LR):
   - Band 9: Full flexibility and precise word usage in all contexts; sustained natural use of idiomatic, native-like language.
   - Band 8: Wide vocabulary used flexibly to discuss all topics and convey precise definitions. Skilful use of rare or idiomatic items (only occasional slips or collocations/word choice inaccuracies). Effective paraphrasing.
   - Band 7: Flexible vocabulary to discuss a variety of topics. Uses some less common & idiomatic elements with style and collocation awareness (some errors/inaccuracies occur). Successful paraphrase.
   - Band 6: Sufficient vocabulary to discuss topics at length, meanings are clear even if some words are inappropriate. Generally able to paraphrase successfully.
   - Band 5: Sufficient vocabulary for familiar/unfamiliar topics but with limited flexibility. Paraphrase is attempted but struggles with success.
   - Band 4: Limited vocabulary mostly used to convey basic personal facts. Frequent errors in word choice. Paraphrasing is rarely attempted.
   - Band 1 to 3: Extremely limited vocabulary consisting of simple words or isolated, repeated words of virtually no communicative significance.

3. GRAMMATICAL RANGE AND ACCURACY (GRA):
   - Band 9: Precise and highly accurate structural control at all times, with only rare slips or mistakes characteristic of native speakers.
   - Band 8: Wide range of flexibly used structures. The majority of sentences are error-free. Occasional non-systematic slips.
   - Band 7: Flexible range of structures. Frequent error-free sentences. Uses both simple and complex sentence structures effectively despite some persistent errors.
   - Band 6: Mix of simple and complex sentences, but limited flexibility. Errors occur frequently in complex forms but rarely block overall communication.
   - Band 5: Multi-clause complex structures are attempted but highly limited/repetitive, contain persistent key errors, or lead to reformulations. Standard basic sentence forms are controlled.
   - Band 4: Basic structures and short utterances are error-free. Subordinate clauses are rare, structural forms are repetitive, and errors are frequent.
   - Band 1 to 3: Grammatical errors are numerous, or no evidence of basic sentence forms.

4. PRONUNCIATION (P):
   - Band 9: Employs full range of phonological features to convey precise/subtle meanings. Flexible, sustained connected speech throughout. Effortlessly understood; accent has no negative effect.
   - Band 8: Wide range of phonological features. Sustains appropriate rhythm, flexible stress/intonation across long utterances (only occasional lapses). Easily understood throughout.
   - Band 7: Meets all positive features of Band 6 and some positive characteristics of Band 8.
   - Band 6: Uses a range of phonological features but control is variable. Chunking is generally okay, but rhythm is sometimes affected by stress-timing or rapid pace. Words/phonemes can be occasionally mispronounced but cause only occasional lack of clarity. Effortlessly understood overall.
   - Band 5: Meets all positive features of Band 4 and some positive characteristics of Band 6.
   - Band 4: Range of phonological features is limited. Some chunking, but frequent lapses in rhythm. Intonation/stress control is limited. Frequent mispronunciations require listener effort.
   - Band 1 to 3: Speech is unintelligible, vowel/consonant sounds are mainly mispronounced, or delivery impairs attempts at connected speech.

Mock Examination Title: ${mockTitle || "IELTS General Speaking Practice"}
Cue Card Topic: ${part2Topic || "unspecified"}
`;

       const { nativeAudioTelemetry } = req.body;
       if (nativeAudioTelemetry && nativeAudioTelemetry.length > 0) {
          prompt += `\nNATIVE AUDIO TELEMETRY (Logged by Live API Examiner natively via pure audio):\n`;
          nativeAudioTelemetry.forEach((t: any, index: number) => {
             prompt += `[Observation ${index + 1} during ${t.stage}]:\n- Accent/Phonemes: ${t.accentAnalysis || 'N/A'}\n- Hesitations/Stutters: ${t.hesitationAnalysis || 'N/A'}\n- Tonality/Rhythm: ${t.tonality || 'N/A'}\n\n`;
          });
       }

       if (pronunciationFeatures) {
         prompt += `
Additionally, the system has computed these acoustic-lexical indicators for the candidate's speech to assist you in assessing Fluency and Pronunciation:
- Average speaking pace: ${pronunciationFeatures.wpm} words per minute (normal standard is 120-150 WPM. Lower WPM suggests hesitation or search loops; abnormally high WPM suggests rushed speech).
- Filler word ratio (like, um, uh, err, etc.): ${pronunciationFeatures.fillerRatio} (higher ratio indicates vocabulary or grammar retrieval search delays).
- Silent/pause ratio: ${pronunciationFeatures.pauseRatio} (higher ratio indicates significant pauses or gaps between words/sentences).
- Total word count spoken by candidate: ${pronunciationFeatures.totalWords} words.

Please incorporate these telemetry features actively into your assessment of both Fluency and Pronunciation under official IELTS descriptors!
`;
       }

       prompt += `
Candidate Transcript of test session:
"""
${transcriptText}
"""

Evaluate carefully. Under official IELTS standards, the 4 individual sub-criteria (Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy, Pronunciation) MUST always be whole integers (e.g. "5.0", "6.0", "7.0", "8.0", "9.0"). They cannot be half-band values like "6.5" or "7.5".
Calculate the overall band score as the mathematically precise average of these 4 whole-integer criteria, rounded to the nearest half or full band according to the official IELTS scale.
Specifically, overall score rounding rules:
- If the average of the 4 sub-criteria has a fractional part of .00 (e.g., 6.00), it remains that whole band (e.g. "6.0").
- If the average of the 4 sub-criteria has a fractional part of .25 (e.g., 6.25), it rounds UP to the nearest half band (e.g. "6.5").
- If the average of the 4 sub-criteria has a fractional part of .50 (e.g., 6.50), it remains that half band (e.g. "6.5").
- If the average of the 4 sub-criteria has a fractional part of .75 (e.g., 6.75), it rounds UP to the next whole band (e.g. "7.0").
Ensure that your JSON output reflects whole integer values (e.g. "6.0", "7.0") for "fluency", "lexical", "grammar", and "pronunciation", while "overall" is rounded using the rules above (e.g. "6.5").

NOTE ON PRONUNCIATION & MULTILANGUAGE FILTERING: The transcript is generated by an automated Web Speech API which automatically corrects misspelled or mispronounced words into the closest sounding valid words if possible. If you notice strange word choices that make no sense contextually (e.g., "countryside" instead of "counter sign", etc.), strongly penalize their Pronunciation score and assume they mispronounced those words. Highlight these words in "mispronouncedWords" array. 
⚠️ STRICT SAFETY MANDATE: The "mispronouncedWords" array MUST contain English-only word spellings. NEVER output any Cyrillic, Russian, or non-English characters/words in this array or anywhere in the JSON breakdown under any circumstances. If the candidate used any foreign phrases, evaluate their English proficiency on standard IELTS criteria and keep all output elements strictly in native English only.

Do not make up fake placeholders; offer a real, sincere diagnostic evaluation based on their specific language characteristics, spelling/grammar mistakes, or vocabulary range. If the transcript is extremely brief (e.g., candidate spoke less than 15 words or 6 seconds), please award low band scores appropriately and explain that there was insufficient spoken sample.

IMPORTANT STYLE RULE: You must write feedback as a native-English IELTS examiner. NEVER use awkward or unedited AI-generated jargon in the feedback text or breakdowns (e.g., avoid "complex syntax clause rates", "voice structure", "repetition loops", "pausing pauses", "naturellement", "hesitation loops"). Write standard professional academic evaluation feedback.

Return your evaluation in JSON shape:
{
  "overall": string,
  "fluency": string,
  "lexical": string,
  "grammar": string,
  "pronunciation": string,
  "feedback": string (brief, professional summary),
  "fluencyBreakdown": {
    "descriptor": string (summary of performance),
    "details": string (detailed description),
    "action": string (constructive action steps)
  },
  "lexicalBreakdown": {
    "descriptor": string,
    "details": string,
    "action": string
  },
  "grammarBreakdown": {
    "descriptor": string,
    "details": string,
    "action": string
  },
  "pronunciationBreakdown": {
    "descriptor": string,
    "details": string,
    "action": string,
    "mispronouncedWords": string[] (Array of misspelled/mispronounced words identified in the audio, e.g. ["example", "another"])
  }
}

Respond ONLY with this JSON block. No markdown wrapping (like \`\`\`json...) and no extra conversational leading or trailing text.`;

       const contents: any[] = [];
       if (wavFileBase64) {
          contents.push({
             inlineData: {
                mimeType: "audio/wav",
                data: wavFileBase64
             }
          });
          prompt += `

CRITICAL MULTIMODAL ASSESSMENT INSTRUCTION:
Listen carefully to the actual audio recording of the candidate's speech during Part 2 provided above.
Evaluate their actual pronunciation of phonemes, word stress, sentence stress, rhythm, chunking, and regional accent influence.
Make sure your IELTS Pronunciation Band Score and the details in the 'pronunciationBreakdown' strictly reflect this real spoken speech. Write standard professional examiner feedback without using awkward AI jargon or repetitive words.
`;
       }
       contents.push({ parts: [{ text: prompt }] });

       const response = await userAi.models.generateContent({
         model: "gemini-3.5-flash",
         contents,
         config: {
           responseMimeType: "application/json"
         }
       });

       keyPoolManager.recordSuccess(selectedKeyObj.id);

       const content = response.text || "{}";
       try {
         const scoreData = JSON.parse(content.trim());
         res.json(scoreData);
       } catch (jsonErr) {
         console.error("Failed to parse JSON reply from Gemini:", content, jsonErr);
         throw jsonErr;
       }
    } catch (e: any) {
       if (selectedKeyObj!) {
          keyPoolManager.recordError(selectedKeyObj.id, e);
       }
       console.error("Real Scoring Error:", maskSecrets(e.message || String(e)));
       res.status(500).json({ error: maskSecrets(e.message || "Failed to generate AI evaluation score.") });
    }
  });

  app.post("/api/generate-mock", async (req, res) => {
    let selectedKeyObj: ManagedKey | null = null;
    try {
      const { topic } = req.body;
      if (!topic) {
        res.status(400).json({ error: "Missing topic" });
        return;
      }

      selectedKeyObj = keyPoolManager.acquireKey("guest", "free");
      const userAi = keyPoolManager.getClient(selectedKeyObj);
      const prompt = `You are an expert IELTS examiner and content creator. The user wants to practice speaking about a specific topic: "${topic}".
Generate a complete IELTS Speaking Test Mock Profile JSON object.
It must contain:
{
  "id": "custom_${Date.now()}",
  "title": "Custom: <A catchy short title for this topic>",
  "part1": ["<question 1 about topic>", "<question 2>", "<question 3>", "<question 4>", "<question 5>"],
  "part2": "Topic 1: Describe <something related to the topic>.\n\nYou should say:\n- <bullet 1>\n- <bullet 2>\n- <bullet 3>\n\nAnd explain <bullet 4>.",
  "part3": ["<discussion question 1>", "<discussion question 2>", "<discussion question 3>", "<discussion question 4>", "<discussion question 5>"]
}
Only output the raw valid JSON, no markdown blocks. Make the questions authentic to IELTS style.`;

      const response = await userAi.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: { temperature: 0.7 }
      });

      keyPoolManager.recordSuccess(selectedKeyObj.id);

      const content = response.text || "{}";
      const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
      const mockProfile = JSON.parse(cleaned);
      res.json(mockProfile);
    } catch (e: any) {
      if (selectedKeyObj) {
        keyPoolManager.recordError(selectedKeyObj.id, e);
      }
      console.error("Generate Mock Error:", e.message);
      res.status(500).json({ error: "Failed to generate mock test." });
    }
  });

  app.post("/api/analyze-part2", async (req, res) => {
    let selectedKeyObj: ManagedKey | null = null;
    try {
      const { transcript, part2Topic } = req.body;
      if (!transcript) {
        res.status(400).json({ error: "Missing transcript" });
        return;
      }

      selectedKeyObj = keyPoolManager.acquireKey("guest", "free");
      const userAi = keyPoolManager.getClient(selectedKeyObj);
      const prompt = `Analyze this IELTS Part 2 transcript.
The topic was: "${part2Topic}"

Candidate transcript:
"${transcript}"

Your task:
1. Identify grammatical errors and provide corrections.
2. Identify vocabulary that could be improved.
3. Identify misspelled words or words that were clearly mispronounced based on the transcript anomalies.

Respond strictly as a JSON object matching this schema:
{
  "grammarErrors": [ {"error": "...", "correction": "..."} ],
  "vocabularyUpgrades": [ {"original": "...", "better": "..."} ],
  "mispronouncedWords": ["word1", "word2"]
}`;

      const response = await userAi.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      });

      keyPoolManager.recordSuccess(selectedKeyObj.id);

      const text = response.text || "{}";
      const cleaned = text.replace(/^```json\n?/, "").replace(/\n?```$/, "");
      res.json(JSON.parse(cleaned));
    } catch (e: any) {
      if (selectedKeyObj) {
        keyPoolManager.recordError(selectedKeyObj.id, e);
      }
      console.error("Part 2 Analysis Error:", e);
      res.status(500).json({ error: "Analysis failed" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    let { sessionId, message: userMsg, language, persona } = req.body;
    
    if (!sessionId || !userMsg) {
       res.status(400).json({ error: "Missing sessionId or message" });
       return;
    }

    if (typeof userMsg !== "string" || userMsg.length > 4000) {
       res.status(400).json({ error: "Message too long or invalid (max 4000 characters)" });
       return;
    }

    // Sanitize parameters to prevent any prompt injection attacks and enforce length limits
    sessionId = sanitizeInput(sessionId, 50);
    userMsg = sanitizeInput(userMsg, 4000);
    language = sanitizeInput(language || "", 30);
    persona = sanitizeInput(persona || "", 150);

    if (!sessionId || !userMsg) {
       res.status(400).json({ error: "Invalid session or message parameters." });
       return;
    }

    console.log(`API /chat called for session ID: ${sessionId.substring(0, 8)}...`);
    const currentApiKey = process.env.GEMINI_API_KEY;
    if (!currentApiKey) {
       res.status(500).json({ error: "GEMINI_API_KEY is not configured in Secrets" });
       return;
    }

    let chat = webChats.get(sessionId);
    
    if (!chat) {
      chat = ai.chats.create({
        model: "gemini-3.5-flash",
        config: {
          systemInstruction: `You are a helpful language learning practice partner. The user is practicing ${language || 'a language'}. Your persona is: ${persona || 'A patient native speaker'}. Keep your responses conversational, natural, and correct their grammar gently if they make obvious mistakes. Respond primarily in the language they are practicing, with concise English translations or tips only when helpful. Format your responses with Markdown if appropriate.`,
        }
      });
      webChats.set(sessionId, chat);
    }

    try {
       const response = await chat.sendMessage({ message: userMsg });
       console.log(`API /chat successful response text returned for session ${sessionId.substring(0, 8)}...`);
       res.json({ text: response.text });
    } catch (e: any) {
       const errorMsg = maskSecrets(e.message || "Something went wrong");
       console.error("Web Chat error:", errorMsg);
       res.status(500).json({ error: errorMsg });
    }
  });
  
  app.post("/api/reset", (req, res) => {
     const { sessionId } = req.body;
     if (sessionId) {
        webChats.delete(sessionId);
     }
     res.json({ success: true });
  });

  // Ensure Vite middleware is mounted for local full-stack dev
  if (includeViteMiddleware) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (includeStaticFrontend) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.all("/api/*", (req, res) => {
      res.status(404).json({ error: "API endpoint not found" });
    });
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

async function startServer() {
  const app = await createApp({
    includeViteMiddleware: process.env.NODE_ENV !== "production",
    includeStaticFrontend: process.env.INCLUDE_STATIC_FRONTEND === "true",
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Web server running on http://0.0.0.0:${PORT}`);
  });

  // Setup Live API WebSocket proxy
  const { WebSocketServer } = await import("ws");
  const { LiveServerMessage, Modality } = await import("@google/genai");
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const ip = (request.headers["x-forwarded-for"] as string || request.socket.remoteAddress || "unknown").split(",")[0].trim();
    if (!rateLimitIP(ip)) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }

    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/live") {
      const token = url.searchParams.get("token") || "";
      const sessionData = token ? verifySignedSessionToken(token) : null;
      if (!sessionData) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", async (clientWs, req) => {
    let pingInterval: NodeJS.Timeout | null = null;
    let session: any = null;
    let currentStage = "SETUP";
    let userName = "Candidate";
    let selectedKeyObj: ManagedKey | null = null;

    try {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token") || "";
      const sessionData = token ? verifySignedSessionToken(token) : null;
      if (!sessionData) {
        clientWs.send(JSON.stringify({ error: "Access Denied: Invalid or expired connection token" }));
        clientWs.close();
        return;
      }

      const { mockId, voiceChoice, part, tier } = sessionData;
      userName = sessionData.userName || "Candidate";
      const userTier = (tier || "free") as any;

      const mockProfile = MOCKS.find(m => m.id === mockId);
      if (!mockProfile) {
        clientWs.send(JSON.stringify({ error: "Invalid Mock Profile Reference" }));
        clientWs.close();
        return;
      }

      try {
         selectedKeyObj = keyPoolManager.acquireKey(userName, userTier);
      } catch (poolErr: any) {
         console.error(`[KeyPool] Denied WebSocket session for user ${userName} due to pool saturation.`);
         clientWs.send(JSON.stringify({ error: poolErr.message || "Key pooling congestion: Please wait a moment." }));
         clientWs.close();
         return;
      }

      const userAi = keyPoolManager.getClient(selectedKeyObj);

      const examinerName = voiceChoice === "eleanor" ? "Dr. Eleanor" : "Dr. Arthur";
      const voice = voiceChoice === "eleanor" ? "Aoede" : "Charon";

      const partNum = part || 1;
      let serverPersonaPrompt = "";
      const baseSystemInstruction = `
NATIVE AUDIO UNDERSTANDING & TELEMETRY:
As a multimodal AI, you hear the user's raw voice natively. Throughout the test, carefully evaluate their pronunciation, hesitations, accent, and rhythm. 
CRITICAL: At the end of Part 1, Part 2, and Part 3 (or whenever you detect significant pronunciation/fluency issues), you MUST silently call the 'log_native_audio_telemetry' function to log your profound acoustic-lexical analysis. Do not mention this to the candidate.

TOKEN SMART USAGE & CONCISENESS:
Keep your spoken responses natural but brief. Do not ramble. Do not over-explain. The candidate should be doing 80% of the talking.
`;

      if (partNum === 1) {
        serverPersonaPrompt = `You are ${examinerName}, an encouraging, professional, friendly, and supportive official IELTS Speaking Examiner.
You are conducting Part 1 of an official, high-stakes IELTS Speaking test with the candidate, ${userName}.
Your tone of voice and pace MUST be measured, reassuring, natural, and friendly. Do NOT rush or speak too fast.

${baseSystemInstruction}

Examiner Rules & Persona:
1. MEASURED, NATURAL TEMPO AND SUPPORTIVE CONNECTIONS:
   - Speak in a calm, slightly slower, and comfortable tempo, like a friendly human examiner.
   - You are highly encouraged to show polite, supportive human connection. Always accept the candidate's responses with occasional brief, encouraging acknowledgments (e.g., "Alright," "Thank you," "I see," "Interesting," "That's fine," or "Thank you very much") before proceeding/asking the next question.
   - Do NOT give personal opinions, lecture, teach, correct grammar, or criticize responses mid-test.

2. STAGE 1: PART 1 QUESTION SEQUENCE:
   - You MUST ask the following EXACT questions in this precise order in Part 1, one by one:
     1. "${mockProfile.part1[0]}"
     2. "${mockProfile.part1[1]}"
     3. "${mockProfile.part1[2]}"
     4. "${mockProfile.part1[3]}"
   - NEVER ask any other questions or deviate from this list. Do not jump back and forth or improvise additional questions.
   - Begin by asking Question 1. Once the candidate responds, accept it warmly (e.g., "Very well," "Thank you," or "I see"), then ask Question 2, and so on.
   - After the candidate finishes answering Question 4, you MUST gracefully transition to Part 2 by saying exactly: "That is the end of Part 1. Now, let's move on to Part 2." 
   - Immediately after you say that transition sentence, you MUST call the 'progress_to_part_2' function. Do NOT wait for the candidate to reply. Do not ask any more questions in Part 1.

3. CONTROL INSTRUCTION OVERRIDES:
   - Automated control messages prefixed with "[SYSTEM]" or "[INSTRUCTION FOR EXAMINER]" are direct instructions. Do NOT speak them out, and do not acknowledge them. Execute the tool call or action immediately as instructed.

Introduction:
Your very first sentence MUST be: "Hello. Welcome to the IELTS Speaking Test. My name is ${examinerName}, and I will be your examiner today. This test consists of three parts. Let's begin with Part 1. Can you please tell me your full name?" Deliver this in a warm, welcoming, calm, and measured tempo. Do NOT say anything else.`;
      } else if (partNum === 2) {
        serverPersonaPrompt = `You are ${examinerName}, an encouraging, professional, friendly, and supportive official IELTS Speaking Examiner.
You are conducting Part 2 of an official, high-stakes IELTS Speaking test with the candidate, ${userName}.
Your tone of voice and pace MUST be measured, reassuring, natural, and friendly.

${baseSystemInstruction}

Examiner Rules & Persona:
1. MEASURED, NATURAL TEMPO AND SUPPORTIVE CONNECTIONS:
   - Speak in a calm, slightly slower, and comfortable tempo, like a friendly human examiner.
   - Choose a warm and professional cadence, ensuring clear pauses between sentences.

2. STAGE 2: PART 2 CUE CARD INSTRUCTIONS AND SPEAKING FLOW:
   - Present the introduction paragraph (provided below) exactly as written. 
   - CRITICAL RULE: IMMEDIATELY after you finish speaking the final word, YOU MUST CALL the 'start_prep_timer' function. DO NOT WAIT. DO NOT SAY ANYTHING ELSE.
   - DO NOT stay silent and wait. You MUST explicitly call 'start_prep_timer' to end your turn.

Introduction:
Your ONE AND ONLY response MUST be: "Now, let's move on to Part 2. I would like you to speak about a topic for one to two minutes. Here is your cue card topic: ${mockProfile.part2}. You have one minute to prepare, and then you should speak for one to two minutes."
Deliver this in a warm, welcoming, calm, and measured tempo. 
CRITICAL: AFTER SAYING THAT PARAGRAPH, YOU MUST CALL 'start_prep_timer'. Do NOT ask any questions.`;
      } else if (partNum === 4) {
        serverPersonaPrompt = `You are ${examinerName}, an encouraging, professional, friendly, and supportive official IELTS Speaking Examiner.
You are conducting Part 2 of an official, high-stakes IELTS Speaking test. 

Your ONE AND ONLY objective in this turn is to say the following sentence EXACTLY as written to the candidate:
"Your one minute preparation time is up. Please start speaking now."

CRITICAL RULE: IMMEDIATELY after you finish saying that sentence, YOU MUST CALL the 'start_speaking_timer' function. DO NOT ask any questions. DO NOT WAIT.`;
      } else {
        serverPersonaPrompt = `You are ${examinerName}, an encouraging, professional, friendly, and supportive official IELTS Speaking Examiner.
You are conducting Part 3 of an official, high-stakes IELTS Speaking test with the candidate, ${userName}.
Your tone of voice and pace MUST be measured, reassuring, natural, and friendly.

${baseSystemInstruction}

Examiner Rules & Persona:
1. MEASURED, NATURAL TEMPO AND SUPPORTIVE CONNECTIONS:
   - Speak in a calm, slightly slower, and comfortable tempo, like a friendly human examiner.
   - You are highly encouraged to show polite, supportive human connection. Always accept the candidate's responses with occasional brief, encouraging acknowledgments (e.g., "Alright," "Thank you," "I see," "Interesting," "That's fine," or "Thank you very much") before proceeding/asking the next question.
   - Do NOT give personal opinions, lecture, teach, correct grammar, or criticize responses mid-test.

2. STAGE 3: PART 3 DISCUSSION SEQUENCE:
   - In Part 3, you MUST ask the following EXACT discussion questions in this precise order, one by one:
     1. "${mockProfile.part3[0]}"
     2. "${mockProfile.part3[1]}"
     3. "${mockProfile.part3[2]}"
     4. "${mockProfile.part3[3]}"
     5. "${mockProfile.part3[4]}"
   - Ask exactly one question at a time. After asking, wait in silence for the candidate to answer.
   - Do NOT deviate from this list, do not improvise, and keep the discussion perfectly structured.
   - Once the candidate finishes answering Question 5, you MUST gracefully conclude the exam by saying exactly: "That is the end of the speaking test. Thank you very much."
   - Immediately after you say that concluding sentence, you MUST call the 'end_test' function. Do NOT wait for the candidate to reply.

3. CONTROL INSTRUCTION OVERRIDES:
   - Automated control messages prefixed with "[SYSTEM]" or "[INSTRUCTION FOR EXAMINER]" are direct instructions. Do NOT speak them out, and do not acknowledge them. Execute the tool call or action immediately as instructed.

Introduction:
Your very first sentence MUST be: "Now, let's move on to Part 3. In this part, we will discuss some general questions related to the topic of Part 2. Let's begin with the first question: ${mockProfile.part3[0]}" Deliver this in a warm, welcoming, calm, and measured tempo. Do NOT say anything else.`;
      }

      session = await userAi.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: any) => {
            if (message.toolCall?.functionCalls) {
               for (const fc of message.toolCall.functionCalls) {
                  if (clientWs.readyState === 1) {
                     clientWs.send(JSON.stringify({ functionCall: fc }));
                  }
               }
            }
            if (message.serverContent?.modelTurn?.parts) {
               for (const part of message.serverContent.modelTurn.parts) {
                 if (part.inlineData?.data) {
                    if (clientWs.readyState === 1 /* OPEN */) {
                       clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                    }
                 }
                 if (part.text) {
                    if (clientWs.readyState === 1 /* OPEN */) {
                       clientWs.send(JSON.stringify({ modelTranscript: part.text }));
                    }
                 }
               }
            }
            if (message.serverContent?.inputTranscription?.text) {
               if (clientWs.readyState === 1) {
                  clientWs.send(JSON.stringify({ userTranscript: message.serverContent.inputTranscription.text }));
               }
            }
            if (message.serverContent?.userTurn?.parts) {
               for (const part of message.serverContent.userTurn.parts) {
                 if (part.text) {
                    if (clientWs.readyState === 1 /* OPEN */) {
                       clientWs.send(JSON.stringify({ userTranscript: part.text }));
                    }
                 }
               }
            }
            // NOTE: functionCalls are parsed from message.toolCall above — do not duplicate here
            if (message.serverContent?.interrupted) {
               if (clientWs.readyState === 1) {
                 clientWs.send(JSON.stringify({ interrupted: true }));
               }
            }
            if (message.serverContent?.turnComplete) {
               if (clientWs.readyState === 1) {
                  clientWs.send(JSON.stringify({ turnComplete: true }));
               }
            }
          },
          onerror: (err: any) => {
            console.error("Live session error:", err);
            if (clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ error: "Gemini connection error" }));
            }
          },
          onclose: () => {
            if (clientWs.readyState === 1) clientWs.close();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: serverPersonaPrompt,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
          inputAudioTranscription: {},  // Enabled user transcription
          outputAudioTranscription: {}, // Enabled speaking transcription
          tools: [{
            functionDeclarations: [
              ...((partNum === 1 ? [
                {
                  name: "progress_to_part_2",
                  description: "Call this when Part 1 is finished, immediately before you start giving Part 2 instructions.",
                  parameters: { type: Type.OBJECT, properties: {} }
                }
              ] : partNum === 2 ? [
                {
                  name: "start_prep_timer",
                  description: "Call this immediately after reading the Part 2 instructions and telling the candidate they have 1 minute to prepare.",
                  parameters: { type: Type.OBJECT, properties: {} }
                }
              ] : partNum === 4 ? [
                {
                  name: "start_speaking_timer",
                  description: "Call this immediately after telling the candidate their 1 minute is up and they should start speaking.",
                  parameters: { type: Type.OBJECT, properties: {} }
                }
              ] : [
                {
                  name: "end_test",
                  description: "Call this when Part 3 is completely finished and the overall test is deeply concluded.",
                  parameters: { type: Type.OBJECT, properties: {} }
                }
              ]) as any),
              {
                  name: "log_native_audio_telemetry",
                  description: "Log insights about pronunciation, stutters, and hesitations. Use this strictly as a background mechanism when analyzing candidate's verbal audio natively.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      accentAnalysis: { type: Type.STRING, description: "Analysis of their accent and phoneme clarity" },
                      hesitationAnalysis: { type: Type.STRING, description: "Analysis of their use of fillers, stutters, and pauses" },
                      tonality: { type: Type.STRING, description: "Analysis of their intonation and speech rhythm" }
                    }
                  }
              }
            ]
          }],
        },
      });

      // Kick off the conversation securely with specific prompts based on the IELTS stage
      let initialMsg = "Hello! I am ready to start the practice test. Please introduce yourself and ask me the first question.";
      if (partNum === 2) {
        initialMsg = `[SYSTEM] Present the Part 2 cue card topic card now. Tell me the topic and its bullet points. Do NOT say hello or introduce yourself again. Begin directly.`;
      } else if (partNum === 3) {
        initialMsg = `[SYSTEM] Begin Part 3 immediately. Do NOT say hello or introduce yourself again. Say: "Now, let's move on to Part 3..." and ask the first discussion question.`;
      }

      // Introduce an elegant 1000ms handshake buffer to ensure WebSocket streaming pipelines
      // on both the client and proxy are thoroughly warm and ready before audio bites are delivered.
      setTimeout(async () => {
        try {
           if (session && clientWs.readyState === 1 /* OPEN */) {
              await session.sendClientContent({ 
                turns: [{ 
                  role: 'user', 
                  parts: [{ text: initialMsg }] 
                }], 
                turnComplete: true 
              });
              console.log("[Proxy] Successfully triggered initial conversation starter message.");
           }
        } catch(e) {
           console.warn("Failed to send initial client content:", e);
        }
      }, 1000);

      // Keep connection alive with simple heartbeat interval (cloud routers kill idle WS)
      pingInterval = setInterval(() => {
        if (clientWs.readyState === 1) {
          try {
             clientWs.ping();
          } catch(e) {}
        }
      }, 30000);

      clientWs.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "ping") {
             if (clientWs.readyState === 1) {
                clientWs.send(JSON.stringify({ type: "pong" }));
             }
             return;
          }
          if (parsed.type === "stage_change") {
             currentStage = parsed.stage || "unknown";
             console.log(`[SESSION] Client notified stage change: ${currentStage} for session token prefix: ${token.substring(0, 10)}...`);
             if (currentStage === "PART_2_SPEAK") {
                if (!sessionAudioBuffers.has(token)) {
                   sessionAudioBuffers.set(token, []);
                }
             }
             return;
          }
          if (parsed.audio) {
            session.sendRealtimeInput({
              audio: { data: parsed.audio, mimeType: "audio/pcm;rate=16000" },
            });
            if (currentStage === "PART_2_SPEAK") {
               const buf = Buffer.from(parsed.audio, "base64");
               const arr = sessionAudioBuffers.get(token);
               if (arr) {
                  arr.push(buf);
               } else {
                  sessionAudioBuffers.set(token, [buf]);
               }
            }
          }
          if (parsed.clientContent) {
            session.sendClientContent(parsed.clientContent);
          }
          if (parsed.functionResponse) {
             session.sendToolResponse({
                 functionResponses: [{
                     id: parsed.functionResponse.id,
                     name: parsed.functionResponse.name,
                     response: parsed.functionResponse.response
                 }]
             });
          }
        } catch (e) {
           console.error("WebSocket payload error:", e);
        }
      });

      clientWs.on("close", () => {
         if (pingInterval) {
            clearInterval(pingInterval);
         }
         try {
            if (session) {
               session.close();
            }
         } catch(e) {}
         // Recycle any active premium dedicated slots on disconnection
         if (userName) {
            keyPoolManager.releasePremiumKey(userName);
         }
         console.log(`[SESSION] WebSocket connection closed by client.`);
      });
    } catch (e: any) {
      console.error("WebSocket setup failed", e);
      if (selectedKeyObj!) {
         keyPoolManager.recordError(selectedKeyObj.id, e);
      }
      if (userName) {
         keyPoolManager.releasePremiumKey(userName);
      }
      if (pingInterval) {
         clearInterval(pingInterval);
      }
      try {
         if (session) {
            session.close();
         }
      } catch(es) {}
      clientWs.close();
    }
  });

}

if (process.env.VERCEL_SERVERLESS_HANDLER !== "1") {
  startServer().catch(err => {
      console.error("Failed to start server", err);
  });
}
