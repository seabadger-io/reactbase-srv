const functions = require('firebase-functions');

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

exports.changeDisplayName = functions.https.onCall((data, context) => {
  const uid = context.auth.uid;
  const displayName = data.displayName;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  if (!displayName.match(/^[a-zA-Z0-9_-]{4,24}$/)) {
    throw new functions.https.HttpsError('invalid-argument',
      'Invalid displayName, expecting: ^[a-zA-Z0-9_-]{4,24}$');
  }
  db.collection('/displayNameMap').doc(displayName).get()
  .then((doc) => {
    if (doc.exists) {
      throw new functions.https.HttpsError('failed-precondition',
        'displayName is already in use');
    }
    return;
  })
  .catch((err) => {
    throw new functions.https.HttpsError('internal', err);
  });
  const oldData = db.collection('/profiles').doc(uid).get()
  .then((doc) => {
    if (doc.exists) {
      return doc.data();
    }
    return {};
  })
  .catch((err) => {
    throw new functions.https.HttpsError('internal', err);
  });
  const batch = db.batch();
  const profileRef = db.collection('/profiles').doc(uid);
  batch.update(profileRef, Object.assign(oldData, {
    displayName: displayName
  }));
  if (oldData.displayName) {
    const oldNameRef = db.collection('/displayNameMap').doc(oldData.displayName);
    batch.delete(oldNameRef);
  }
  const newNameRef = db.collection('/displayNameMap').doc(displayName);
  batch.create(newNameRef, {
    uid: uid,
  });
  return batch.commit()
    .then(() => {
      return oldData;
    })
    .catch((err) => {
      return functions.https.HttpsError('internal', err);
    });
});
