// Import the Firebase Admin SDK
import * as admin from "firebase-admin";
import path from "path";

if (process.env.NODE_ENV === "test") {
  admin.initializeApp({
    projectId: "waterdrop-api-test",
    storageBucket: "waterdrop-api-test.invalid",
  });
} else {
  if (!process.env.FIREBASE_CREDENTIAL_FILE) {
    throw new Error("FIREBASE_CREDENTIAL_FILE is not defined");
  }
  const serviceAccountPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_CREDENTIAL_FILE,
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    storageBucket: process.env.FIREBASE_BUCKET,
  });
}

const bucket = admin.storage().bucket();

// Optionally, you can export the bucket if you need to use it elsewhere
export { bucket };

// Export the initialized admin objects
export default admin;
