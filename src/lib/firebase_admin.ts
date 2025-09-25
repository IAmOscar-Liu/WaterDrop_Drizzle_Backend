// Import the Firebase Admin SDK
import * as admin from "firebase-admin";

// Import your service account key JSON file
// Ensure the path is correct relative to this file
const serviceAccount = require("../../flutter-ad-commerce-firebase-adminsdk-fbsvc-5ed5ed03a1.json");

// Initialize the Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "flutter-ad-commerce.firebasestorage.app",
});

const bucket = admin.storage().bucket();

// Optionally, you can export the bucket if you need to use it elsewhere
export { bucket };

// Export the initialized admin objects
export default admin;
