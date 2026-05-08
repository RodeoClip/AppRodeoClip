import { UserSession } from '../types';
import { logger } from './loggingService';

// Mock API delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const api = {
  checkout: async (): Promise<{ checkoutUrl: string; sessionId: string }> => {
    logger.log('checkout_initiated');
    await delay(1000);
    const paymentLink = (process.env.STRIPE_PAYMENT_LINK_URL as string) || '';
    if (paymentLink) {
      return {
        checkoutUrl: paymentLink,
        sessionId: `cs_test_${Math.random().toString(36).substring(7)}`
      };
    }
    try {
      const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
      const base = isLocal ? 'http://localhost:4242' : '';
      const res = await fetch(`${base}/api/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: process.env.STRIPE_PRICE_ID })
      });
      const data = await res.json();
      return {
        checkoutUrl: data.url || '#',
        sessionId: data.id || `cs_test_${Math.random().toString(36).substring(7)}`
      };
    } catch (err) {
      logger.log('checkout_failed', { err });
      return {
        checkoutUrl: '#',
        sessionId: `cs_test_${Math.random().toString(36).substring(7)}`
      };
    }
  },

  validatePayment: async (sessionId: string): Promise<UserSession> => {
    logger.log('payment_validation_start', { sessionId });
    await delay(1500);
    // Simulate webhook confirmation via Supabase
    return {
      isAuthenticated: true,
      subscriptionStatus: 'active',
      downloadToken: `jwt_token_${Math.random().toString(36).substring(2)}`,
      tokenExpiry: Date.now() + 5 * 60 * 1000 // 5 minutes
    };
  },

  processVideo: async (fileId: string, token: string, settings: any) => {
    logger.log('processing_start', { fileId, settings });
    
    // Verify token
    if (!token) throw new Error("Unauthorized");
    
    // Simulate Server-Side BullMQ Job
    await delay(3000); // Simulate FFmpeg processing time
    
    logger.log('processing_complete', { fileId });
    return {
      downloadUrl: `https://api.rodeoclip.com/download/${fileId}_converted.mp4?token=${token}`
    };
  }
};
