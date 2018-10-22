const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp()
const db = admin.firestore();
db.settings({ timestampsInSnapshots: true });

exports.onCreateUser = functions.auth.user().onCreate((user) => {
  const updateObject = {
    email: user.email,
    emailVerified: user.emailVerified,
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
  let uidToChange = uid;
  const username = data.username;
  return new Promise((resolve, reject) => {
    if (!uid) {
      return reject(new functions.https.HttpsError('unauthenticated', 'Authentication required'));
    }

    return new Promise((resolve, reject) => {
      db.collection('/users').doc(uid).get()
      .then((doc) => {
        // authorize
        if (!doc.exists) {
          return reject(new functions.https.HttpsError('permission-denied', 'User has no user information'));
        }
        const userMeta = doc.data();
        // override the changed userid if an admin requests the change
        if (data.uid) {
          if (data.uid !== uid && !userMeta.isAdmin) {
            return reject(new functions.https.HttpsError('permission-denied', 'Not authorized to change this username'));
          } else {
            uidToChange = data.uid;
          }
        }
        if (userMeta.isSuspended || userMeta.isDeleted) {
          return reject(new functions.https.HttpsError('permission-denied', 'User is suspended or deleted'));
        }
        return resolve(userMeta);
      })
      .catch((err) => reject(new functions.https.HttpsError('internal', err)));
    })
    .then(() => db.collection('/usernameMap').doc(username).get())
    .then((doc) => {
      // check if user already exists
      return new Promise((resolve, reject) => {
        if (doc.exists) {
          return reject(new functions.https.HttpsError('already-exists',
            'username is already in use'));
        }
        return resolve({});
      })
    })
    .then(() => db.collection('users').doc(uidToChange).get())
    .then((profileDoc) => {
      // create update batch
      let oldProfile = {};
      if (profileDoc.exists) {
        oldProfile = profileDoc.data();
      }
      if (!username.match(/^[a-zA-Z0-9_-]{4,24}$/)) {
        return reject(new functions.https.HttpsError('invalid-argument',
        'Invalid username, expecting: ^[a-zA-Z0-9_-]{4,24}$'));
      }
      const batch = db.batch();
      const profileRef = db.collection('users').doc(uidToChange);
      const updatedProfile = Object.assign({}, oldProfile);
      updatedProfile.username = username;
      batch.update(profileRef, updatedProfile);
      if (oldProfile.username) {
        const oldNameRef = db.collection('usernameMap').doc(oldProfile.username);
        batch.delete(oldNameRef);
      }
      const newNameRef = db.collection('usernameMap').doc(updatedProfile.username);
      batch.create(newNameRef, {
        uid: uidToChange,
      });
      return batch.commit();
    })
    .then(() => {
      console.log(`CHANGE_USERNAME [SUCCESS][auth: ${uid}][changeUid: ${uidToChange}][username: ${data.username}]`);
      return resolve({ username: username });
    })
    .catch(err => {
      const error = err instanceof functions.https.HttpsError ? err
      : new functions.https.HttpsError('internal', err);
      console.log(`CHANGE_USERNAME [FAILED][auth: ${uid}][changeUid: ${uidToChange}][username: ${data.username}][code: ${err.code}][message: ${err.message}]`);
      return reject(error);
    });
  });
});

exports.getAccessToken = functions.https.onCall((data, context) => {
  let uid = context.auth.uid;
  return new Promise((resolve, reject) => {
    if (!uid) {
      return reject(new functions.https.HttpsError('unauthenticated', 'Authentication required'));
    }
    return new Promise((resolve, reject) => {
      db.collection('/users').doc(uid).get()
      .then((doc) => {
        // authorize
        if (!doc.exists) {
          return reject(new functions.https.HttpsError('permission-denied', 'User has no user information'));
        }
        const userMeta = doc.data();
        if (userMeta.isSuspended || userMeta.isDeleted) {
          return reject(new functions.https.HttpsError('permission-denied', 'User is suspended or deleted'));
        }
        // impersonate user if an admin requests it
        if (data.uid) {
          if (data.uid !== uid && !userMeta.isAdmin) {
            return reject(new functions.https.HttpsError('permission-denied', 'Not authorized to change context'));
          } else {
            uid = data.uid;
          }
        }
        return resolve(uid);
      })
      .catch((err) => reject(new functions.https.HttpsError('internal', err)));
    })
    .then((uid) => admin.auth().createCustomToken(uid))
    .then((customToken) => {
      console.log(`GET_ACCESS_TOKEN  [SUCCESS][auth: ${context.auth.uid}][effectiveUid: ${uid}]`);
      return resolve(customToken);
    })
    .catch(err => {
      const error = err instanceof functions.https.HttpsError ? err
      : new functions.https.HttpsError('internal', err);
      console.log(`GET_ACCESS_TOKEN [FAILED][auth: ${context.auth.uid}][effectiveUid: ${uid}][code: ${err.code}][message: ${err.message}]`);
      return reject(error);
    });
  });
});
