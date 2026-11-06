/*  ============================  IRONFORGE CONFIG  ============================
    1. Create a free Firebase project at https://console.firebase.google.com
    2. Add a "Web app", copy its firebaseConfig object and paste it below.
    3. Follow README.md (enable sign-in providers, Firestore, security rules).

    Leave `firebase: null` to run in LOCAL MODE: accounts and games are stored
    in this browser only (good for trying the site; Google/GitHub sign-in and
    real online play need Firebase).                                          */
window.IRONFORGE_CONFIG = {
  firebase: null,
  /* Example:
  firebase: {
    apiKey: "AIza...",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abc123"
  },
  */

  // The account with this username is the site moderator (admin panel + MOD badge).
  adminUsername: 'Dorian',

  siteName: 'IronForge Chess',
};
