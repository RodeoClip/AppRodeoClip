
import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { VideoFile, ConversionSettings, UserSession, ProcessingStatus } from '../types';
import { clearStorage } from '../services/storageService';
import { logger } from '../services/loggingService';
import { blobManager } from '../services/blobManager';

interface AppState {
  files: VideoFile[];
  settings: ConversionSettings;
  session: UserSession;
  status: ProcessingStatus;
  activeFileId: string | null;
  progress: { total: number; completed: number };
}

type Action =
  | { type: 'ADD_FILES'; payload: VideoFile[] }
  | { type: 'SET_FILES'; payload: VideoFile[] }
  | { type: 'REMOVE_FILE'; payload: string }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<ConversionSettings> }
  | { type: 'SET_SESSION'; payload: UserSession }
  | { type: 'SET_STATUS'; payload: ProcessingStatus }
  | { type: 'SET_ACTIVE_FILE'; payload: string }
  | { type: 'SET_PROGRESS'; payload: { total: number; completed: number } }
  | { type: 'RESET_APP' };

const initialState: AppState = {
  files: [],
  settings: {
    speed: 1.0,
    logo: null,
    logoUrl: null,
    logoPosition: { x: 50, y: 50 },
    logoEditing: false,
    logoScale: 0.3,
    autoCrop: true,
    outputQuality: '1080p',
    rotation: 90, // Default to 90 (Vertical) automatically
    muteAudio: false
  },
  session: {
    isAuthenticated: false,
    subscriptionStatus: 'none',
    downloadToken: null,
    tokenExpiry: null
  },
  status: ProcessingStatus.IDLE,
  activeFileId: null,
  progress: { total: 0, completed: 0 }
};

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
}>({ state: initialState, dispatch: () => null });

const appReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'ADD_FILES':
      return { ...state, files: [...state.files, ...action.payload] };
    case 'SET_FILES':
      {
        const firstPreviewable = action.payload.find(f => !!f.previewUrl);
        return { ...state, files: action.payload, activeFileId: (firstPreviewable?.id || action.payload[0]?.id || null) };
      }
    case 'REMOVE_FILE':
      const newFiles = state.files.filter(f => f.id !== action.payload);
      const nextActive = newFiles.find(f => !!f.previewUrl)?.id || newFiles[0]?.id || null;
      return { 
        ...state, 
        files: newFiles,
        activeFileId: state.activeFileId === action.payload ? nextActive : state.activeFileId 
      };
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'SET_SESSION':
      return { ...state, session: action.payload };
    case 'SET_STATUS':
      return { ...state, status: action.payload };
    case 'SET_ACTIVE_FILE':
      return { ...state, activeFileId: action.payload };
    case 'SET_PROGRESS':
      return { ...state, progress: action.payload };
    case 'RESET_APP':
      return initialState;
    default:
      return state;
  }
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const prevFileIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevFileIdsRef.current;
    const next = new Set(state.files.map(f => f.id));
    prev.forEach((id) => {
      if (!next.has(id)) {
        blobManager.revoke(id);
        blobManager.revoke(`compat:${id}`);
      }
    });
    prevFileIdsRef.current = next;
  }, [state.files]);

  useEffect(() => {
    if (!state.settings.logoUrl) {
      blobManager.revoke('logo');
    }
  }, [state.settings.logoUrl]);

  useEffect(() => {
    return () => {
      blobManager.revokeAll();
      clearStorage().catch(console.error);
      logger.log('app_session_end');
    };
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
