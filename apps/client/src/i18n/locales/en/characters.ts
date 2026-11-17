import type { characters as Zh } from "../zh/characters.ts";

export const characters: typeof Zh = {
  deepseek: {
    name: "Big Fat Fish",
    tagline: "DeepSeek whale girl",
    intro: "Chatty and cheerful. Keeps you company and watches videos for you.",
    greeting: "Whale hello! You're here! I'm Big Fat Fish.\nIs there anything you'd like to talk about, or a video you want me to watch?",
  },
  claude: {
    name: "Claudie",
    tagline: "Claude girl",
    intro: "Loves books and a cup of black tea. Happy to chat at a slow pace.",
    greeting: "Hi there, I'm Claudie.\nI just made a cup of black tea. Where shall we start?",
  },
  chatgpt: {
    name: "Gippy",
    tagline: "ChatGPT girl",
    intro: "Fresh and crisp. Helps you sort your thoughts out one by one.",
    greeting: "Yay, you're here! I'm Gippy.\nWhat do you feel like talking about today? I'll help you sort it out~",
  },
  whale: {
    name: "Jingxi",
    tagline: "Original character",
    intro: "A friend from the seaside who lives in your phone. Chats with you and watches videos for you.",
    greeting: "Hi there, I'm Jingxi.\nI live in your phone, and I'll chat with you and watch videos for you. Where would you like to start today?",
  },
};
