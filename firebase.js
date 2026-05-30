// =======================
// Firebase Configuration & Auth
// =======================

const firebaseConfig = {
  apiKey: "AIzaSyBx5c4TSEzc7BY7LI2kHgM5puv3alDRAlI",
  authDomain: "loginpage-afafa.firebaseapp.com",
  projectId: "loginpage-afafa",
  storageBucket: "loginpage-afafa.firebasestorage.app",
  messagingSenderId: "71200892764",
  appId: "1:71200892764:web:800176090a62fc69084399"
};

// Initialize Firebase — guard against duplicate SDK loads (caused by loading scripts twice)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// Make currentUser accessible globally
let currentUser = null;

// Expose functions globally so script.js can use them
window.firebaseAuth = {
    getCurrentUser: () => currentUser,
    setCurrentUser: (user) => { currentUser = user; }
};

// Safe wrapper — showNotification lives in script.js which loads after firebase.js
function _notify(msg, type) {
  if (typeof showNotification === 'function') {
    showNotification(msg, type);
  } else {
    // Fallback until script.js is ready
    setTimeout(() => showNotification && showNotification(msg, type), 300);
  }
}

// Auth State Listener
auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = {
      name: user.displayName || user.email?.split('@')[0] || 'User',
      email: user.email
    };
  } else {
    currentUser = null;
  }
  if (typeof window.updateUserUI === 'function') {
    window.updateUserUI();
  }
});

// =======================
// Auth Functions
// =======================

window.signUp = async function() {
  const name     = document.getElementById('signupName').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value.trim();

  if (!name || !email || !password) { _notify('⚠️ All fields are required!', 'error'); return; }
  if (name.length < 2) { _notify('⚠️ Please enter your full name!', 'error'); return; }
  if (password.length < 6)          { _notify('⚠️ Password must be at least 6 characters!', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _notify('⚠️ Please enter a valid email address!', 'error'); return; }

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    await userCredential.user.updateProfile({ displayName: name });
    _notify('✅ Account created successfully!', 'success');
    closeAuthModal();
  } catch (error) {
    console.error('SignUp error:', error);
    const friendlyMsg = {
      'auth/email-already-in-use': '⚠️ An account with this email already exists.',
      'auth/invalid-email':        '❌ Please enter a valid email address.',
      'auth/weak-password':        '⚠️ Password is too weak. Use at least 6 characters.',
      'auth/operation-not-allowed': '❌ Email sign-up is currently disabled.',
    }[error.code] || '❌ Sign-up failed. Please try again.';
    _notify(friendlyMsg, 'error');
  }
};

window.login = async function() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!email || !password) { _notify('⚠️ Please fill all fields!', 'error'); return; }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    closeAuthModal();
    _notify('👋 Welcome back!', 'success');
  } catch (error) {
    console.error('Login error:', error);
    const friendlyMsg = {
      'auth/user-not-found':  '❌ No account found with this email.',
      'auth/wrong-password':  '❌ Incorrect password. Please try again.',
      'auth/invalid-email':   '❌ Please enter a valid email address.',
      'auth/too-many-requests': '⚠️ Too many attempts. Please try again later.',
      'auth/user-disabled':   '❌ This account has been disabled.',
    }[error.code] || '❌ Login failed. Please check your credentials.';
    _notify(friendlyMsg, 'error');
  }
};

window.logout = function() {
  auth.signOut()
    .then(() => _notify('👋 Logged out successfully!', 'info'))
    .catch(err => console.error(err));
};
