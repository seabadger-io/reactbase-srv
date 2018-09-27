const functions = require('firebase-functions');
//const cors = require('cors')({ origin: true });

const admin = require('firebase-admin');
admin.initializeApp()
const db = admin.firestore();
db.settings({ timestampsInSnapshots: true });

exports.onCreateUser = functions.auth.user().onCreate((user) => {
  const updateObject = {
    email: user.email,
    createdAt: Date.now(),
    isDeleted: false,
    isSuspended: false,
    isAdmin: false,
  };
  return db.collection('/users').doc(user.uid).set(updateObject)
  .then(() => {
    console.log(`Created new user ${user.uid}, email: ${user.email}`);
    return true;
  })
  .catch((err) => {
    console.error(`Error (${err}) while creating user ${user.uid}, email: ${user.email}`);
    return false;
  });
});

exports.onDeleteUser = functions.auth.user().onDelete((user) => {
  const updateObject = {
    email: '[DELETED]-' + user.uid,
    isDeleted: true,
    deletedAt: Date.now(),
  };
  return db.collection('/users').doc(user.uid).update(updateObject)
  .then(() => {
    console.log(`Deleted user ${user.uid}, email: ${user.email}`);
    return true;
  })
  .catch((err) => {
    console.error(`Error (${err}) while deleting user ${user.uid}, email: ${user.email}`);
    return false;
  });
});

exports.changeUsername = functions.https.onCall((data, context) => {
  const uid = context.auth.uid;
  const username = data.username;
  return new Promise((resolve, reject) => {
    if (!uid) {
      return reject(new functions.https.HttpsError('unauthenticated', 'Authentication required'));
    }
    if (!username.match(/^[a-zA-Z0-9_-]{4,24}$/)) {
      return reject(new functions.https.HttpsError('invalid-argument',
        'Invalid username, expecting: ^[a-zA-Z0-9_-]{4,24}$'));
    }
    const checkUserAlreadyExists = db.collection('/usernameMap').doc(username).get()
    .then((doc) => {
      if (doc.exists) {
        return reject(new functions.https.HttpsError('failed-precondition',
          'username is already in use'));
      }
      return {};
    })
    .catch(err => reject(new functions.https.HttpsError('internal', err)));
  
    const getExistingProfile = checkUserAlreadyExists.then(() => {
      return db.collection('profiles').doc(uid).get();
    });

    const profileUpdate = getExistingProfile.then((profileDoc) => {
      let oldProfile = {};
      if (profileDoc.exists) {
        oldProfile = profileDoc.data();
      }
      const batch = db.batch();
      const profileRef = db.collection('profiles').doc(uid);
      const updatedProfile = Object.assign({}, oldProfile);
      updatedProfile.username = username;
      batch.update(profileRef, updatedProfile);
      if (oldProfile.username) {
        const oldNameRef = db.collection('usernameMap').doc(oldProfile.username);
        batch.delete(oldNameRef);
      }
      const newNameRef = db.collection('usernameMap').doc(updatedProfile.username);
      batch.create(newNameRef, {
        uid: uid,
      });
      return batch.commit();
    })
    .catch(err => reject(new functions.https.HttpsError('internal', err)));
    return profileUpdate.then(() => {
      return resolve({ username: username });
    }).catch(err => reject(new functions.https.HttpsError('internal', err)));
  });
});
