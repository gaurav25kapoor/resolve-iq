import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

if (!getApps().length) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (clientEmail && privateKey) {
    initializeApp({
      credential: cert({
        projectId: firebaseConfig.projectId,
        clientEmail,
        privateKey,
      }),
      projectId: firebaseConfig.projectId,
    });
  } else {
    // Preserve Application Default Credentials for local/GCP environments.
    initializeApp({ projectId: firebaseConfig.projectId });
  }
}

export const adminAuth = getAuth();
export { firebaseConfig };
