
export interface VideoFile {
  id: string;
  file: File;
  previewUrl: string | null;
  relativePath?: string;
  duration: number;
  format: string;
  size: number;
  thumbnail?: string;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  PREVIEW_GENERATING = 'PREVIEW_GENERATING',
  READY_TO_PAY = 'READY_TO_PAY',
  PAID = 'PAID',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export interface ConversionSettings {
  speed: number; // 1.0 is normal, 0.5 is slow motion
  logo: File | null;
  logoUrl: string | null;
  logoPosition: { x: number; y: number };
  logoEditing: boolean;
  logoScale: number;
  autoCrop: boolean;
  outputQuality: '1080p' | '4k';
  rotation: 0 | 90;
  muteAudio?: boolean;
}

export interface UserSession {
  isAuthenticated: boolean;
  subscriptionStatus: 'active' | 'past_due' | 'canceled' | 'incomplete' | 'none';
  downloadToken: string | null;
  tokenExpiry: number | null;
}

export interface LogEvent {
  event: string;
  timestamp: number;
  data?: Record<string, any>;
}
