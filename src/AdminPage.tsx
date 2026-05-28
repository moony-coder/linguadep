import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Users, Activity, Clock, ShieldCheck, RefreshCw, X, Server, Eye } from 'lucide-react';
import { cn } from './lib/utils';
import { apiUrl } from './lib/backend';

export default function AdminPage({ onExit }: { onExit: () => void }) {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = async () => {
    try {
      const res = await fetch(apiUrl('/api/admin/metrics'));
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000); // refresh every 5s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 bg-stone-105 z-[100] flex flex-col font-sans overflow-hidden">
      {/* Admin Header */}
      <div className="bg-stone-850 text-white px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <ShieldCheck size={24} className="text-emerald-400" />
          <h1 className="text-xl font-bold tracking-tight font-display">System Admin Dashboard</h1>
          <span className="bg-stone-700 text-stone-300 text-xs px-2 py-0.5 rounded-full font-mono ml-2 border border-stone-600">LIVE</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={fetchMetrics}
            className="flex items-center gap-2 px-3 py-1.5 text-stone-300 hover:text-white transition-colors"
          >
            <RefreshCw size={16} className={cn("text-stone-400", loading && "animate-spin")} />
            <span className="text-sm font-medium">Refresh</span>
          </button>
          <div className="w-px h-6 bg-stone-700" />
          <button 
            onClick={onExit}
            className="flex items-center gap-2 px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-xl transition-colors font-medium text-sm"
          >
            <X size={16} />
            <span>Close Dashboard</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Top level stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-3xl p-6 border border-stone-200 shadow-sm flex flex-col">
              <div className="flex items-center gap-3 mb-2 text-stone-500">
                <Users size={20} className="text-emerald-600" />
                <span className="font-semibold text-sm uppercase tracking-wider">Active Users</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold font-display text-stone-850">
                  {metrics?.activeUsersCount || 0}
                </span>
                <span className="text-stone-500 font-medium">currently online</span>
              </div>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-stone-200 shadow-sm flex flex-col">
              <div className="flex items-center gap-3 mb-2 text-stone-500">
                <Activity size={20} className="text-amber-600" />
                <span className="font-semibold text-sm uppercase tracking-wider">Today's Logins/Visits</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold font-display text-stone-850">
                  {metrics?.totalConnectionsToday || 0}
                </span>
                <span className="text-stone-500 font-medium">unique sessions</span>
              </div>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-stone-200 shadow-sm flex flex-col">
              <div className="flex items-center gap-3 mb-2 text-stone-500">
                <Server size={20} className="text-blue-600" />
                <span className="font-semibold text-sm uppercase tracking-wider">System Status</span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xl font-bold text-stone-850 font-display">Operational</span>
              </div>
            </div>
          </div>

          {/* Gemini Key Pool Monitor */}
          <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
            <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
              <div className="flex items-center gap-3">
                <Server size={20} className="text-violet-600" />
                <h3 className="text-lg font-bold font-display text-stone-800">Gemini Key Quota Pools ({metrics?.keys?.length || 0} Keys Active)</h3>
              </div>
              <span className="bg-violet-100 text-violet-700 text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
                15 RPM Free Tier Quota Isolation
              </span>
            </div>
            
            <div className="overflow-x-auto">
              {metrics && metrics.keys && metrics.keys.length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-50 text-stone-400 border-b border-stone-100 text-xs uppercase tracking-wider font-semibold">
                      <th className="px-6 py-4">Key ID / Name</th>
                      <th className="px-6 py-4">Pool Category</th>
                      <th className="px-6 py-4">Status & Health</th>
                      <th className="px-6 py-4">Current Load (RPM)</th>
                      <th className="px-6 py-4">Assigned To</th>
                      <th className="px-6 py-4 text-center">Requests (Ok/Err)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {metrics.keys.map((keyObj: any) => {
                      const isEmergency = keyObj.pool === "emergency";
                      const isPremium = keyObj.pool === "premium";
                      const isCasual = keyObj.pool === "casual";
                      const isFree = keyObj.pool === "free";
                      
                      const isBlocked = keyObj.status.toLowerCase().includes("blocked");
                      const parsedRpm = keyObj.rpm || 0;
                      const rpmPercent = Math.min(100, Math.ceil((parsedRpm / 15) * 100));
                      
                      return (
                        <tr key={keyObj.id} className="hover:bg-stone-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-mono text-sm font-bold text-stone-700">{keyObj.id}</span>
                              <span className="text-xs text-stone-400 font-mono font-medium">{keyObj.modelUsed}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {isFree && (
                              <span className="bg-zinc-100 text-zinc-700 border border-zinc-200 text-xs px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                                Free Pool
                              </span>
                            )}
                            {isCasual && (
                              <span className="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                                Casual Pool
                              </span>
                            )}
                            {isPremium && (
                              <span className="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                                Premium Dedicated
                              </span>
                            )}
                            {isEmergency && (
                              <span className="bg-rose-50 text-rose-700 border border-rose-200 text-xs px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                                Emergency Pool
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {isBlocked ? (
                                <>
                                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                                  <span className="text-rose-700 text-xs font-bold font-mono px-2 py-0.5 bg-rose-50 rounded-md">
                                    {keyObj.status}
                                  </span>
                                </>
                              ) : parsedRpm >= 12 ? (
                                <>
                                  <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                                  <span className="text-orange-700 text-xs font-bold font-mono px-2 py-0.5 bg-orange-50 rounded-md">
                                    HIGH LOAD
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                  <span className="text-emerald-700 text-xs font-bold font-mono px-2 py-0.5 bg-emerald-50 rounded-md">
                                    ONLINE (HEALTHY)
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col w-36 gap-1">
                              <div className="flex justify-between text-xs font-mono font-medium text-stone-500">
                                <span>{parsedRpm} / 15 RPM</span>
                                <span>{rpmPercent}%</span>
                              </div>
                              <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                                <div 
                                  className={cn(
                                    "h-full transition-all duration-300 rounded-full",
                                    isBlocked ? "bg-rose-400" :
                                    parsedRpm >= 12 ? "bg-orange-500" : 
                                    parsedRpm >= 8 ? "bg-amber-400" : "bg-emerald-500"
                                  )}
                                  style={{ width: `${rpmPercent}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {keyObj.assignedToUser ? (
                              <div className="flex items-center gap-2">
                                <div className="h-6 w-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                                  {keyObj.assignedToUser.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm font-bold text-stone-600 truncate max-w-[120px]">{keyObj.assignedToUser}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-stone-400 font-medium">Unallocated (Rotational)</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex justify-center items-center gap-2 text-xs font-medium">
                              <span className="text-emerald-600 font-bold" title="Successful requests">
                                {keyObj.totalSuccessfulRequests || 0}
                              </span>
                              <span className="text-stone-300">/</span>
                              <span className="text-stone-400" title="Total requests">
                                {keyObj.totalRequests || 0}
                              </span>
                              {keyObj.totalFailedRequests > 0 && (
                                <>
                                  <span className="text-stone-300">/</span>
                                  <span className="text-rose-500 font-bold" title="Failed requests">
                                    {keyObj.totalFailedRequests}
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 text-center text-stone-500 flex flex-col items-center">
                  <Server size={48} className="text-stone-200 mb-4 animate-pulse" />
                  <p className="font-medium">Acquiring API Key status...</p>
                </div>
              )}
            </div>
          </div>

          {/* Active Sessions Table */}
          <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
            <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
              <div className="flex items-center gap-3">
                <Eye size={20} className="text-stone-400" />
                <h3 className="text-lg font-bold font-display text-stone-800">Live Visitor Feed</h3>
              </div>
              <div className="text-sm text-stone-500 font-medium">
                Auto-updating every 5s
              </div>
            </div>
            
            <div className="overflow-x-auto">
              {metrics && metrics.users && metrics.users.length > 0 ? (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-50 text-stone-400 border-b border-stone-100 text-xs uppercase tracking-wider font-semibold">
                      <th className="px-6 py-4">User Name</th>
                      <th className="px-6 py-4">Status & Action</th>
                      <th className="px-6 py-4">Path</th>
                      <th className="px-6 py-4">IP Address</th>
                      <th className="px-6 py-4">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {metrics.users.map((user: any) => (
                      <tr key={user.clientId} className="hover:bg-stone-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-stone-150 flex items-center justify-center text-stone-500 font-bold font-display text-sm">
                              {user.userName ? user.userName.charAt(0).toUpperCase() : '?'}
                            </div>
                            <span className="font-bold text-stone-700">{user.userName || 'Anonymous'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {user.inactiveTimeSeconds < 10 ? (
                              <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
                            ) : (
                              <span className="flex h-2 w-2 rounded-full bg-amber-500"></span>
                            )}
                            <span className={cn("text-sm font-medium", user.inactiveTimeSeconds < 10 ? "text-emerald-700" : "text-amber-700")}>
                              {user.action}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-mono text-stone-500 bg-stone-100 px-2 py-1 rounded-md">
                            {user.path}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs text-stone-400">
                            {user.ip}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-stone-500 flex items-center gap-2">
                            <Clock size={14} className="text-stone-300" />
                            {user.inactiveTimeSeconds}s ago
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 text-center text-stone-500 flex flex-col items-center">
                  <Activity size={48} className="text-stone-200 mb-4" />
                  <p className="font-medium">No active users found on the platform.</p>
                  <p className="text-sm mt-1 text-stone-400">Waiting for connections or telemetry pings...</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
