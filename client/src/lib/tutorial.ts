import { request } from './api';

/**
 * Guided tutorial content.
 *
 * Every lesson names a stable `data-tour` anchor that the app shell renders. When
 * the anchor is missing (for example a panel that is collapsed at that viewport)
 * the overlay falls back to a centred card instead of pretending to point at it.
 */

export type LessonId =
  | 'dashboard'
  | 'profile'
  | 'friends'
  | 'messages'
  | 'servers'
  | 'channels'
  | 'voice'
  | 'notifications'
  | 'ai'
  | 'support'
  | 'safety';

export interface Lesson {
  id: LessonId;
  number: number;
  title: string;
  summary: string;
  points: string[];
  /** Route to visit before highlighting, so the anchor exists on screen. */
  path: string;
  /** Preferred anchor, then fallbacks, then a centred card. */
  anchors: string[];
  /** Shown when the anchor cannot be found at this viewport. */
  fallbackNote?: string;
}

export const LESSONS: Lesson[] = [
  {
    id: 'dashboard',
    number: 1,
    title: 'Your Dashboard',
    summary: 'Chatter opens on a home screen built around what matters right now.',
    points: [
      'Recent conversations surface the people you talk to most.',
      'Your servers and quick channel access sit alongside them.',
      'Unread badges tell you exactly where new messages are waiting.',
    ],
    path: '/',
    anchors: ['[data-tour="nav-home"]'],
  },
  {
    id: 'profile',
    number: 2,
    title: 'Your Profile',
    summary: 'Your profile is how people recognise you across Chatter.',
    points: [
      'Upload an avatar and banner, and pick an accent colour.',
      'Set a display name, custom status and an about-me section.',
      'Choose online, idle, do-not-disturb or invisible presence.',
    ],
    path: '/',
    anchors: ['[data-tour="nav-profile"]'],
  },
  {
    id: 'friends',
    number: 3,
    title: 'Adding Friends',
    summary: 'Find people by username and start a conversation in seconds.',
    points: [
      'Search for an exact username to send a friend request.',
      'Accept, reject or cancel requests from the Friends page.',
      'Blocked users can never message you again.',
    ],
    path: '/',
    anchors: ['[data-tour="nav-friends"]'],
  },
  {
    id: 'messages',
    number: 4,
    title: 'Direct Messages',
    summary: 'Private one-to-one and group conversations with full message controls.',
    points: [
      'Reply, react, edit, pin and search inside a conversation.',
      'Typing indicators and read receipts update in real time.',
      'Mute or archive a conversation without leaving it.',
    ],
    path: '/',
    anchors: ['[data-tour="nav-messages"]'],
  },
  {
    id: 'servers',
    number: 5,
    title: 'Servers',
    summary: 'Servers are your communities, with their own members and roles.',
    points: [
      'Create a server or join one with an invite link.',
      'Owners control icons, banners, descriptions and discovery.',
      'Roles and permissions decide who can do what.',
    ],
    path: '/servers',
    anchors: ['[data-tour="nav-servers"]', '[data-tour="servers-grid"]'],
  },
  {
    id: 'channels',
    number: 6,
    title: 'Channels',
    summary: 'Text and voice channels keep conversations organised by topic.',
    points: [
      'Group channels into collapsible categories.',
      'Private and read-only channels restrict who can read or post.',
      'Drag channels to reorder them inside a category.',
    ],
    path: '/servers',
    anchors: ['[data-tour="channels-panel"]', '[data-tour="nav-servers"]'],
    fallbackNote: 'Open a server to see its channel list.',
  },
  {
    id: 'voice',
    number: 7,
    title: 'Voice and Video',
    summary: 'Join a voice channel, then turn on camera or share your screen.',
    points: [
      'Microphone, deafen and camera controls sit in the call bar.',
      'Pick input and output devices, and set volumes in settings.',
      'Screen sharing and video tiles appear for every participant.',
    ],
    path: '/servers',
    anchors: ['[data-tour="channels-panel"]', '[data-tour="nav-servers"]'],
    fallbackNote: 'Join a voice channel in any server to try the call controls.',
  },
  {
    id: 'notifications',
    number: 8,
    title: 'Notifications and Sounds',
    summary: 'Decide what interrupts you, and how it sounds.',
    points: [
      'Mute individual conversations or whole servers.',
      'Turn browser notifications and mention alerts on or off.',
      'Choose which call and channel sounds play, and at what volume.',
    ],
    path: '/',
    anchors: ['[data-tour="nav-notifications"]', '[data-tour="nav-settings"]'],
  },
  {
    id: 'ai',
    number: 9,
    title: 'Chatter AI',
    summary: 'A private assistant that only sees what you choose to send it.',
    points: [
      'Start a new AI conversation and keep separate chat histories.',
      'Conversations are private to your account.',
      'Chatter never sends your messages or servers to the AI on its own.',
    ],
    path: '/ai',
    anchors: ['[data-tour="nav-ai"]'],
  },
  {
    id: 'support',
    number: 10,
    title: 'Support Tickets',
    summary: 'Reach the Chatter team when something needs a human.',
    points: [
      'Open a ticket with a subject, category, priority and screenshots.',
      'Reply back and forth and watch the status change.',
      'Reopen a resolved ticket if the problem returns.',
    ],
    path: '/support',
    anchors: ['[data-tour="nav-support"]'],
  },
  {
    id: 'safety',
    number: 11,
    title: 'Safety and Privacy',
    summary: 'You control who can reach you and what others can see.',
    points: [
      'Block or report a user from their profile or a message.',
      'Manage blocked lists and privacy controls in settings.',
      'Reports go to staff and are never shown to the reported user.',
    ],
    path: '/',
    anchors: ['[data-tour="nav-settings"]'],
  },
];

export const LESSON_IDS = LESSONS.map((lesson) => lesson.id);
export const TOTAL_LESSONS = LESSONS.length;

export interface TutorialProgress {
  completedLessons: LessonId[];
  lastLesson: string | null;
  completedAt: string | null;
  completed: boolean;
  totalLessons: number;
}

export const emptyProgress: TutorialProgress = {
  completedLessons: [],
  lastLesson: null,
  completedAt: null,
  completed: false,
  totalLessons: TOTAL_LESSONS,
};

export const tutorialApi = {
  get: () => request<{ progress: TutorialProgress }>('/api/me/tutorial'),
  save: (patch: { completedLessons?: LessonId[]; lastLesson?: string | null; completed?: boolean }) =>
    request<{ progress: TutorialProgress }>('/api/me/tutorial', { method: 'PATCH', body: patch }),
};

export const lessonById = (id: string | null | undefined): Lesson | null =>
  LESSONS.find((lesson) => lesson.id === id) ?? null;
