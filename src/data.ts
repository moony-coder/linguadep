export type MockProfile = {
  id: string;
  title: string;
  part1: string[];
  part2: string;
  part2Bullets?: string[];
  part3: string[];
};

export const MOCKS: MockProfile[] = [
  {
    id: "mock1",
    title: "Mock Test 1: Hometown, Travel & Culture",
    part1: [
      "Let's start by talking about your hometown. Where is your hometown located?",
      "What was the most memorable trip or holiday you have ever taken?"
    ],
    part2: "Describe a quiet place that you like to spend time in.",
    part2Bullets: [
      "where this place is",
      "how you found out about this place",
      "what you normally do there",
      "explain why you like to go to this quiet place."
    ],
    part3: [
      "Why do some people prefer quiet places while others like busy, crowded environments?",
      "What are the benefits of quiet relaxation for physical and mental health?"
    ]
  },
  {
    id: "mock2",
    title: "Mock Test 2: Studies, Leisure & Plants",
    part1: [
      "Let's start by talking about your study or work. Do you study or do you work?",
      "What is your main reason for choosing that particular area of study or career?",
      "Let's talk about plants. Do you like having plants in your home or garden?",
      "Did you learn about plants or nature during your childhood at school?"
    ],
    part2: "Describe a friend of yours who is good at singing or music.",
    part2Bullets: [
      "who this person is",
      "how you met or know them",
      "what kind of music or singing they do",
      "explain how you feel when you listen to them perform."
    ],
    part3: [
      "Why is music such an important part of human culture and celebrations?",
      "Do you think every child should be required to learn to play a musical instrument?",
      "What are the benefits of children learning music compared to sports?",
      "How is modern digital technology changing the way people listen to or create music?",
      "Should governments provide financial funding to preserve traditional cultural music?"
    ]
  },
  {
    id: "mock3",
    title: "Mock Test 3: Daily Routines, Friends & Sport",
    part1: [
      "Let's talk about your daily routine. What is your favorite part of the day?",
      "How do you usually organize your study or work time?",
      "Let's move on to friends. Do you prefer spending time with one close friend or a large group?",
      "What did you and your friends enjoy doing together when you were a child?"
    ],
    part2: "Describe a wild animal that you want to know more about.",
    part2Bullets: [
      "what animal it is",
      "where it lives in the wild",
      "what you know about its habits or appearance",
      "explain why you want to learn more about this animal."
    ],
    part3: [
      "Why are some people more willing to support wild animal conservation than others?",
      "Should parents take their young children to zoos or wildlife reserves?",
      "How has human urbanization affected the habitats of wild animals?",
      "Do you agree that sporting activities are an excellent way to connect people from different countries?",
      "What role should environmental documentaries play in educating the public about wild animals?"
    ]
  }
];
