// Import the Firebase Admin SDK
import * as admin from "firebase-admin";
import path from "path";

console.log(`credential: ${process.env.FIREBASE_CREDENTIAL_FILE}`);
console.log(`storageBucket: ${process.env.FIREBASE_BUCKET}`);

if (!process.env.FIREBASE_CREDENTIAL_FILE) {
  throw new Error("FIREBASE_CREDENTIAL_FILE is not defined");
}
const serviceAccountPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_CREDENTIAL_FILE,
);

// Initialize the Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
  storageBucket: process.env.FIREBASE_BUCKET,
});

const bucket = admin.storage().bucket();

console.log("Firebase Admin SDK has been initialized.");

// Optionally, you can export the bucket if you need to use it elsewhere
export { bucket };

// Export the initialized admin objects
export default admin;
