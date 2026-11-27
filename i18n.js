/* Texts of the app in English, French and Hebrew. t('key', { name: 'Hippo' }) */
const LANGS = { en: 'English', fr: 'Français', he: 'עברית' };

const TEXT = {
  en: {
    email: 'Email', password: 'Password', login: 'Log in', loggingIn: 'Logging in…', forgot: 'Forgot password?',
    newTeam: 'New to the team?', createAccount: 'Create an account', createTitle: 'Create an account',
    createHint: 'An owner approves new accounts. You get an email when it\'s done.', yourName: 'Your name',
    pwLabel: 'Password (at least 10 characters)', pwAgain: 'Password again', sendRequest: 'Send my request',
    backLogin: '‹ Back to log in', forgotTitle: 'Forgot password', forgotHint: 'Enter your email. We\'ll send you a link to choose a new password.',
    sendLink: 'Send me a link', chooseTitle: 'Choose your password', newPw: 'New password (at least 10 characters)', newPwAgain: 'New password again',
    savePw: 'Save password', backToLogin: 'Back to log in', pleaseWait: 'Please wait…', sending: 'Sending…', savingBtn: 'Saving…',
    errEmailPw: 'Enter your email and password.', errNameEmail: 'Enter your name and email.', errPwLen: 'The password needs at least 10 characters.',
    errPwDiff: 'The two passwords are different.', errEmail: 'Enter your email.',
    doneRegister: 'Thanks {name}! Your request was sent. You will get an email as soon as an owner approves it, then you can log in.',
    doneForgot: 'If an account exists for {email}, we sent it a link to choose a new password. Check your inbox (and spam). The link works for 1 hour.',
    pwSaved: 'Password saved ✓ You can log in now.', pwSavedPending: 'Password saved. Your account still needs an owner\'s approval.',
    noInventory: 'You have no inventory yet. Ask an owner.',
    search: 'Search product or supplier', all: 'All', todo: 'Not counted', doneF: 'Counted',
    ready: 'Ready', saving: 'Saving…', allSaved: 'All saved ✓', retrying: 'Retrying…', notSaved: 'Not saved – check connection',
    bottles: 'bottles', counted: '{n} / {t} counted', finish: 'Finish', next: 'Next not counted', allCounted: 'Everything is counted ✓',
    edit: 'Edit', noProducts: 'No products in {inv} yet.', addFirst: '＋ Add the first product', askManager: 'Ask a manager to add them.', noMatch: 'No products match.',
    stepWhole: '+ and − now count whole units', stepFine: '+ and − now count 0.1', enterNumber: 'Enter a number, e.g. 3 or 0.5',
    stillSaving: 'Still saving, try again in a second.', upToDate: 'Up to date ✓', couldNotSave: 'Could not save. Check your connection.',
    finishTitle: 'Finish the count', month: 'Month', inventory: 'Inventory', productsCounted: 'Products counted', totalBottles: 'Total bottles',
    totalValue: 'Total value (H.T)', countedBy: 'Sent by', notCountedList: '{n} not counted yet. They will be sent as 0:',
    sendOffice: 'Send to office', downloadExcel: 'Download Excel', backCounting: 'Back to counting',
    confirmSend: 'Send the {inv} inventory for {month} to the office?', sentTo: 'Sent to {to} ✓', sendFailed: 'Sending failed',
    addProduct: '＋ Add a product', newMonth: 'Start a new month (clear all counts)', team: 'Team members', refresh: 'Refresh',
    changePw: 'Change my password', language: 'Language', logout: 'Log out',
    confirmReset: 'Clear ALL counts in {inv} to start a new month?\n\nMake sure last month was sent to the office first.',
    countsCleared: 'Counts cleared. Ready for a new month.',
    addProductTo: 'Add a product to {inv}', editProduct: 'Edit product', productName: 'Product name', category: 'Category',
    supplier: 'Supplier', priceHT: 'Price H.T (€)', pricePer: 'Price H.T (€) per', unit: 'Unit', save: 'Save', removeProduct: 'Remove this product',
    removeHint: 'Only remove a product you no longer work with. If it is just out of stock, count it as 0.',
    enterProductName: 'Enter a product name.', saved: 'Saved ✓', productAdded: 'Product added ✓', removed: 'Removed',
    confirmRemoveProduct: 'Remove "{name}" from {inv}?',
    changePwTitle: 'Change my password', currentPw: 'Current password', saveNewPw: 'Save new password', cancel: 'Cancel',
    pwChanged: 'Password changed ✓ Other phones are logged out.',
    teamTitle: 'Team members', waiting: 'Waiting for approval ({n})', teamHead: 'Team', shareLink: 'Share the sign-up link', close: 'Close',
    noTeam: 'No team members yet.', ownerAll: 'Owner · all inventories', noAccess: 'No access yet', noPwYet: 'no password yet',
    asked: 'asked {when}', blocked: 'Blocked',
    approveQ: 'Approve {name}?', approveHint: 'Choose what {name} can do, then approve. They get an email.', name: 'Name',
    ownerCheck: 'Owner (all inventories + team)', none: 'None', count: 'Count', manager: 'Manager', owner: 'Owner',
    approve: 'Approve', rejectReq: 'Reject request', removeTeam: 'Remove from team', block: 'Block (logs them out now)', unblock: 'Unblock',
    emailReset: 'Email a password reset link', emailSet: 'Email a "set your password" link', back: 'Back',
    approvedToast: '{name} approved ✓ They got an email.', confirmReject: 'Reject the request from {name}?',
    confirmRemoveMember: 'Remove {name} from the team? They will be logged out.',
    confirmBlock: 'Block {name}? They are logged out right away and cannot log in until unblocked.',
    rejected: 'Rejected', blockedToast: 'Blocked', unblockedToast: 'Unblocked', linkSent: 'Link sent to {email} ✓', linkCopied: 'Link copied ✓',
    inviteText: 'Join the Zoutra / Adraba inventory app: open this link, tap "Create an account", then add it to your home screen.',
    chooseInv: 'Choose an inventory', off: 'Coming soon',
    pwTip: 'At least 10 characters. Tip: 3–4 words, e.g. "blue cellar tuesday".', pwShort: 'At least 10 characters ({n}/10). Tip: 3–4 words.',
    pwWeak: 'Weak – easy to guess. Try 3–4 words.', pwOk: 'OK', pwStrong: 'Strong ✓',
    noConn: 'No connection. Check your internet and try again.', badServer: 'The server did not answer correctly. Try again.',
    'type:Wine & Alcohol': 'Wine & alcohol', 'type:Wine': 'Wine', 'type:Alcohol': 'Alcohol', 'type:Food': 'Food',
    'unit:kg': 'kg', 'unit:g': 'g', 'unit:L': 'L', 'unit:piece': 'piece', 'unit:box': 'box', 'unit:bottle': 'bottle',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  },

  fr: {
    email: 'E-mail', password: 'Mot de passe', login: 'Se connecter', loggingIn: 'Connexion…', forgot: 'Mot de passe oublié ?',
    newTeam: 'Nouveau dans l\'équipe ?', createAccount: 'Créer un compte', createTitle: 'Créer un compte',
    createHint: 'Un propriétaire valide les nouveaux comptes. Vous recevrez un e-mail une fois validé.', yourName: 'Votre prénom',
    pwLabel: 'Mot de passe (10 caractères minimum)', pwAgain: 'Confirmer le mot de passe', sendRequest: 'Envoyer ma demande',
    backLogin: '‹ Retour à la connexion', forgotTitle: 'Mot de passe oublié', forgotHint: 'Entrez votre e-mail. Nous vous enverrons un lien pour choisir un nouveau mot de passe.',
    sendLink: 'Recevoir le lien', chooseTitle: 'Choisissez votre mot de passe', newPw: 'Nouveau mot de passe (10 caractères minimum)', newPwAgain: 'Confirmer le nouveau mot de passe',
    savePw: 'Enregistrer', backToLogin: 'Retour à la connexion', pleaseWait: 'Un instant…', sending: 'Envoi…', savingBtn: 'Enregistrement…',
    errEmailPw: 'Entrez votre e-mail et votre mot de passe.', errNameEmail: 'Entrez votre prénom et votre e-mail.', errPwLen: 'Le mot de passe doit faire au moins 10 caractères.',
    errPwDiff: 'Les deux mots de passe sont différents.', errEmail: 'Entrez votre e-mail.',
    doneRegister: 'Merci {name} ! Votre demande est envoyée. Vous recevrez un e-mail dès qu\'un propriétaire l\'aura validée, puis vous pourrez vous connecter.',
    doneForgot: 'Si un compte existe pour {email}, un lien vient d\'être envoyé pour choisir un nouveau mot de passe. Vérifiez votre boîte (et les spams). Le lien est valable 1 heure.',
    pwSaved: 'Mot de passe enregistré ✓ Vous pouvez vous connecter.', pwSavedPending: 'Mot de passe enregistré. Votre compte attend encore la validation d\'un propriétaire.',
    noInventory: 'Vous n\'avez encore accès à aucun inventaire. Demandez à un propriétaire.',
    search: 'Chercher un produit ou fournisseur', all: 'Tout', todo: 'Pas compté', doneF: 'Compté',
    ready: 'Prêt', saving: 'Enregistrement…', allSaved: 'Tout est enregistré ✓', retrying: 'Nouvel essai…', notSaved: 'Non enregistré – vérifiez la connexion',
    bottles: 'bouteilles', counted: '{n} / {t} comptés', finish: 'Terminer', next: 'Suivant non compté', allCounted: 'Tout est compté ✓',
    edit: 'Modifier', noProducts: 'Aucun produit dans {inv} pour l\'instant.', addFirst: '＋ Ajouter le premier produit', askManager: 'Demandez à un manager de les ajouter.', noMatch: 'Aucun produit trouvé.',
    stepWhole: '+ et − comptent maintenant par unité', stepFine: '+ et − comptent maintenant par 0,1', enterNumber: 'Entrez un nombre, ex. 3 ou 0,5',
    stillSaving: 'Enregistrement en cours, réessayez dans une seconde.', upToDate: 'À jour ✓', couldNotSave: 'Impossible d\'enregistrer. Vérifiez la connexion.',
    finishTitle: 'Terminer l\'inventaire', month: 'Mois', inventory: 'Inventaire', productsCounted: 'Produits comptés', totalBottles: 'Total bouteilles',
    totalValue: 'Valeur totale (H.T)', countedBy: 'Envoyé par', notCountedList: '{n} pas encore comptés. Ils seront envoyés à 0 :',
    sendOffice: 'Envoyer au bureau', downloadExcel: 'Télécharger l\'Excel', backCounting: 'Retour au comptage',
    confirmSend: 'Envoyer l\'inventaire {inv} de {month} au bureau ?', sentTo: 'Envoyé à {to} ✓', sendFailed: 'Échec de l\'envoi',
    addProduct: '＋ Ajouter un produit', newMonth: 'Nouveau mois (effacer tous les comptes)', team: 'Équipe', refresh: 'Actualiser',
    changePw: 'Changer mon mot de passe', language: 'Langue', logout: 'Se déconnecter',
    confirmReset: 'Effacer TOUS les comptes de {inv} pour commencer un nouveau mois ?\n\nVérifiez d\'abord que le mois dernier a été envoyé au bureau.',
    countsCleared: 'Comptes effacés. Prêt pour le nouveau mois.',
    addProductTo: 'Ajouter un produit à {inv}', editProduct: 'Modifier le produit', productName: 'Nom du produit', category: 'Catégorie',
    supplier: 'Fournisseur', priceHT: 'Prix H.T (€)', pricePer: 'Prix H.T (€) par', unit: 'Unité', save: 'Enregistrer', removeProduct: 'Supprimer ce produit',
    removeHint: 'Supprimez seulement un produit que vous ne travaillez plus. S\'il est juste en rupture, comptez-le à 0.',
    enterProductName: 'Entrez un nom de produit.', saved: 'Enregistré ✓', productAdded: 'Produit ajouté ✓', removed: 'Supprimé',
    confirmRemoveProduct: 'Supprimer « {name} » de {inv} ?',
    changePwTitle: 'Changer mon mot de passe', currentPw: 'Mot de passe actuel', saveNewPw: 'Enregistrer le nouveau mot de passe', cancel: 'Annuler',
    pwChanged: 'Mot de passe changé ✓ Les autres téléphones sont déconnectés.',
    teamTitle: 'Équipe', waiting: 'En attente de validation ({n})', teamHead: 'Équipe', shareLink: 'Partager le lien d\'inscription', close: 'Fermer',
    noTeam: 'Personne dans l\'équipe pour l\'instant.', ownerAll: 'Propriétaire · tous les inventaires', noAccess: 'Pas encore d\'accès', noPwYet: 'pas encore de mot de passe',
    asked: 'demande du {when}', blocked: 'Bloqué',
    approveQ: 'Valider {name} ?', approveHint: 'Choisissez ce que {name} peut faire, puis validez. Un e-mail lui sera envoyé.', name: 'Prénom',
    ownerCheck: 'Propriétaire (tous les inventaires + équipe)', none: 'Aucun', count: 'Comptage', manager: 'Manager', owner: 'Propriétaire',
    approve: 'Valider', rejectReq: 'Refuser la demande', removeTeam: 'Retirer de l\'équipe', block: 'Bloquer (déconnexion immédiate)', unblock: 'Débloquer',
    emailReset: 'Envoyer un lien de réinitialisation', emailSet: 'Envoyer un lien « choisir son mot de passe »', back: 'Retour',
    approvedToast: '{name} validé ✓ Un e-mail a été envoyé.', confirmReject: 'Refuser la demande de {name} ?',
    confirmRemoveMember: 'Retirer {name} de l\'équipe ? Il sera déconnecté.',
    confirmBlock: 'Bloquer {name} ? Déconnexion immédiate, plus d\'accès jusqu\'au déblocage.',
    rejected: 'Refusé', blockedToast: 'Bloqué', unblockedToast: 'Débloqué', linkSent: 'Lien envoyé à {email} ✓', linkCopied: 'Lien copié ✓',
    inviteText: 'Rejoins l\'app d\'inventaire Zoutra / Adraba : ouvre ce lien, touche « Créer un compte », puis ajoute-la à ton écran d\'accueil.',
    chooseInv: 'Choisir un inventaire', off: 'Bientôt',
    pwTip: '10 caractères minimum. Astuce : 3–4 mots, ex. « cave bleue mardi ».', pwShort: '10 caractères minimum ({n}/10). Astuce : 3–4 mots.',
    pwWeak: 'Faible – facile à deviner. Essayez 3–4 mots.', pwOk: 'Correct', pwStrong: 'Solide ✓',
    noConn: 'Pas de connexion. Vérifiez Internet et réessayez.', badServer: 'Le serveur n\'a pas répondu correctement. Réessayez.',
    'type:Wine & Alcohol': 'Vins & alcools', 'type:Wine': 'Vins', 'type:Alcohol': 'Alcools', 'type:Food': 'Cuisine',
    'unit:kg': 'kg', 'unit:g': 'g', 'unit:L': 'L', 'unit:piece': 'pièce', 'unit:box': 'carton', 'unit:bottle': 'bouteille',
    months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    mon: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  },

  he: {
    email: 'אימייל', password: 'סיסמה', login: 'כניסה', loggingIn: 'מתחבר…', forgot: 'שכחת סיסמה?',
    newTeam: 'חדש בצוות?', createAccount: 'יצירת חשבון', createTitle: 'יצירת חשבון',
    createHint: 'בעלים מאשרים חשבונות חדשים. תקבל/י אימייל כשהחשבון יאושר.', yourName: 'השם שלך',
    pwLabel: 'סיסמה (לפחות 10 תווים)', pwAgain: 'סיסמה שוב', sendRequest: 'שליחת הבקשה',
    backLogin: '› חזרה לכניסה', forgotTitle: 'שכחתי סיסמה', forgotHint: 'הכנס/י את האימייל שלך ונשלח קישור לבחירת סיסמה חדשה.',
    sendLink: 'שלחו לי קישור', chooseTitle: 'בחירת סיסמה', newPw: 'סיסמה חדשה (לפחות 10 תווים)', newPwAgain: 'סיסמה חדשה שוב',
    savePw: 'שמירת סיסמה', backToLogin: 'חזרה לכניסה', pleaseWait: 'רגע…', sending: 'שולח…', savingBtn: 'שומר…',
    errEmailPw: 'הכנס/י אימייל וסיסמה.', errNameEmail: 'הכנס/י שם ואימייל.', errPwLen: 'הסיסמה צריכה לפחות 10 תווים.',
    errPwDiff: 'שתי הסיסמאות שונות.', errEmail: 'הכנס/י אימייל.',
    doneRegister: 'תודה {name}! הבקשה נשלחה. תקבל/י אימייל ברגע שאחד הבעלים יאשר, ואז אפשר להיכנס.',
    doneForgot: 'אם קיים חשבון עבור {email}, נשלח אליו קישור לבחירת סיסמה חדשה. בדוק/י את תיבת הדואר (וגם ספאם). הקישור תקף לשעה.',
    pwSaved: 'הסיסמה נשמרה ✓ אפשר להיכנס.', pwSavedPending: 'הסיסמה נשמרה. החשבון עדיין ממתין לאישור.',
    noInventory: 'עדיין אין לך גישה לאף מלאי. פנה/י לאחד הבעלים.',
    search: 'חיפוש מוצר או ספק', all: 'הכול', todo: 'לא נספר', doneF: 'נספר',
    ready: 'מוכן', saving: 'שומר…', allSaved: 'הכול נשמר ✓', retrying: 'מנסה שוב…', notSaved: 'לא נשמר – בדוק/י חיבור',
    bottles: 'בקבוקים', counted: '{n} / {t} נספרו', finish: 'סיום', next: 'הבא שלא נספר', allCounted: 'הכול נספר ✓',
    edit: 'עריכה', noProducts: 'אין עדיין מוצרים ב{inv}.', addFirst: '＋ הוספת המוצר הראשון', askManager: 'בקש/י ממנהל להוסיף אותם.', noMatch: 'לא נמצאו מוצרים.',
    stepWhole: '+ ו־− סופרים עכשיו יחידות שלמות', stepFine: '+ ו־− סופרים עכשיו 0.1', enterNumber: 'הכנס/י מספר, למשל 3 או 0.5',
    stillSaving: 'עדיין שומר, נסה/י שוב בעוד שנייה.', upToDate: 'מעודכן ✓', couldNotSave: 'לא נשמר. בדוק/י את החיבור.',
    finishTitle: 'סיום הספירה', month: 'חודש', inventory: 'מלאי', productsCounted: 'מוצרים שנספרו', totalBottles: 'סה״כ בקבוקים',
    totalValue: 'שווי כולל (לפני מע״מ)', countedBy: 'נשלח ע״י', notCountedList: '{n} עדיין לא נספרו. הם יישלחו כ־0:',
    sendOffice: 'שליחה למשרד', downloadExcel: 'הורדת אקסל', backCounting: 'חזרה לספירה',
    confirmSend: 'לשלוח את מלאי {inv} של {month} למשרד?', sentTo: 'נשלח אל {to} ✓', sendFailed: 'השליחה נכשלה',
    addProduct: '＋ הוספת מוצר', newMonth: 'חודש חדש (מחיקת כל הספירות)', team: 'צוות', refresh: 'רענון',
    changePw: 'שינוי הסיסמה שלי', language: 'שפה', logout: 'התנתקות',
    confirmReset: 'למחוק את כל הספירות ב{inv} ולהתחיל חודש חדש?\n\nוודא/י קודם שהחודש הקודם נשלח למשרד.',
    countsCleared: 'הספירות נמחקו. מוכן לחודש חדש.',
    addProductTo: 'הוספת מוצר ל{inv}', editProduct: 'עריכת מוצר', productName: 'שם המוצר', category: 'קטגוריה',
    supplier: 'ספק', priceHT: 'מחיר לפני מע״מ (€)', pricePer: 'מחיר לפני מע״מ (€) ל־', unit: 'יחידה', save: 'שמירה', removeProduct: 'מחיקת המוצר',
    removeHint: 'מחק/י רק מוצר שכבר לא עובדים איתו. אם הוא רק חסר במלאי, ספור/י אותו כ־0.',
    enterProductName: 'הכנס/י שם מוצר.', saved: 'נשמר ✓', productAdded: 'המוצר נוסף ✓', removed: 'נמחק',
    confirmRemoveProduct: 'למחוק את "{name}" מ{inv}?',
    changePwTitle: 'שינוי הסיסמה שלי', currentPw: 'הסיסמה הנוכחית', saveNewPw: 'שמירת הסיסמה החדשה', cancel: 'ביטול',
    pwChanged: 'הסיסמה שונתה ✓ טלפונים אחרים נותקו.',
    teamTitle: 'צוות', waiting: 'ממתינים לאישור ({n})', teamHead: 'צוות', shareLink: 'שיתוף קישור ההרשמה', close: 'סגירה',
    noTeam: 'אין עדיין אנשי צוות.', ownerAll: 'בעלים · כל המלאים', noAccess: 'אין גישה עדיין', noPwYet: 'אין סיסמה עדיין',
    asked: 'ביקש/ה ב־{when}', blocked: 'חסום',
    approveQ: 'לאשר את {name}?', approveHint: 'בחר/י מה {name} יכול/ה לעשות ואשר/י. יישלח אימייל.', name: 'שם',
    ownerCheck: 'בעלים (כל המלאים + צוות)', none: 'ללא', count: 'ספירה', manager: 'מנהל', owner: 'בעלים',
    approve: 'אישור', rejectReq: 'דחיית הבקשה', removeTeam: 'הסרה מהצוות', block: 'חסימה (ניתוק מיידי)', unblock: 'ביטול חסימה',
    emailReset: 'שליחת קישור לאיפוס סיסמה', emailSet: 'שליחת קישור לבחירת סיסמה', back: 'חזרה',
    approvedToast: '{name} אושר/ה ✓ נשלח אימייל.', confirmReject: 'לדחות את הבקשה של {name}?',
    confirmRemoveMember: 'להסיר את {name} מהצוות? החשבון ינותק.',
    confirmBlock: 'לחסום את {name}? ניתוק מיידי, ללא אפשרות כניסה עד ביטול החסימה.',
    rejected: 'נדחה', blockedToast: 'נחסם', unblockedToast: 'החסימה בוטלה', linkSent: 'קישור נשלח אל {email} ✓', linkCopied: 'הקישור הועתק ✓',
    inviteText: 'הצטרפו לאפליקציית המלאי של זוטרה / אדרבה: פתחו את הקישור, לחצו "יצירת חשבון" והוסיפו למסך הבית.',
    chooseInv: 'בחירת מלאי', off: 'בקרוב',
    pwTip: 'לפחות 10 תווים. טיפ: 3–4 מילים, למשל "מרתף כחול שלישי".', pwShort: 'לפחות 10 תווים ({n}/10). טיפ: 3–4 מילים.',
    pwWeak: 'חלשה – קל לנחש. נסה/י 3–4 מילים.', pwOk: 'סבירה', pwStrong: 'חזקה ✓',
    noConn: 'אין חיבור. בדוק/י את האינטרנט ונסה/י שוב.', badServer: 'השרת לא ענה כראוי. נסה/י שוב.',
    'type:Wine & Alcohol': 'יין ואלכוהול', 'type:Wine': 'יין', 'type:Alcohol': 'אלכוהול', 'type:Food': 'מטבח',
    'unit:kg': 'ק״ג', 'unit:g': 'גרם', 'unit:L': 'ליטר', 'unit:piece': 'יחידה', 'unit:box': 'קרטון', 'unit:bottle': 'בקבוק',
    months: ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'],
    mon: ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳']
  }
};

/* Messages that come from the server (always in English) → translated. */
const SERVER_MSG = [
  [/^Wrong email or password/, { fr: 'E-mail ou mot de passe incorrect.', he: 'אימייל או סיסמה שגויים.' }],
  [/waiting for approval/, { fr: 'Votre compte attend la validation d\'un propriétaire.', he: 'החשבון ממתין לאישור של אחד הבעלים.' }],
  [/account is blocked/, { fr: 'Ce compte est bloqué. Demandez à un propriétaire.', he: 'החשבון חסום. פנה/י לאחד הבעלים.' }],
  [/^Too many wrong passwords/, { fr: 'Trop d\'essais. Réessayez dans 15 minutes ou utilisez « Mot de passe oublié ».', he: 'יותר מדי ניסיונות. נסה/י שוב בעוד 15 דקות או השתמש/י ב"שכחת סיסמה".' }],
  [/login has expired|Please log in/, { fr: 'Votre session a expiré. Reconnectez-vous.', he: 'פג תוקף ההתחברות. היכנס/י שוב.' }],
  [/no longer active/, { fr: 'Ce compte n\'est plus actif.', he: 'החשבון כבר לא פעיל.' }],
  [/already exists/, { fr: 'Un compte existe déjà avec cet e-mail. Connectez-vous ou utilisez « Mot de passe oublié ».', he: 'כבר קיים חשבון עם האימייל הזה. היכנס/י או השתמש/י ב"שכחת סיסמה".' }],
  [/valid email/, { fr: 'Entrez un e-mail valide.', he: 'הכנס/י אימייל תקין.' }],
  [/enter your name/, { fr: 'Entrez votre prénom.', he: 'הכנס/י את שמך.' }],
  [/needs at least 10/, { fr: 'Le mot de passe doit faire au moins 10 caractères.', he: 'הסיסמה צריכה לפחות 10 תווים.' }],
  [/too common|too easy|too simple|only numbers/, { fr: 'Mot de passe trop facile à deviner. Astuce : 3–4 mots, ex. « cave bleue mardi ».', he: 'הסיסמה קלה מדי לניחוש. טיפ: 3–4 מילים, למשל "מרתף כחול שלישי".' }],
  [/link is not valid/, { fr: 'Ce lien n\'est plus valable. Demandez-en un nouveau avec « Mot de passe oublié ».', he: 'הקישור כבר לא בתוקף. בקש/י חדש דרך "שכחת סיסמה".' }],
  [/current password is not correct/, { fr: 'Le mot de passe actuel est incorrect.', he: 'הסיסמה הנוכחית שגויה.' }],
  [/Too many sign-up/, { fr: 'Trop de demandes en ce moment. Réessayez dans une heure.', he: 'יותר מדי בקשות כרגע. נסה/י שוב בעוד שעה.' }],
  [/do not have access/, { fr: 'Vous n\'avez pas accès à ceci.', he: 'אין לך גישה לזה.' }],
  [/Choose at least one inventory/, { fr: 'Choisissez au moins un inventaire avant de valider.', he: 'בחר/י לפחות מלאי אחד לפני האישור.' }],
  [/at least one owner/, { fr: 'Il faut toujours au moins un propriétaire.', he: 'חייב להישאר לפחות בעלים אחד.' }],
  [/Product not found/, { fr: 'Produit introuvable. Actualisez l\'app.', he: 'המוצר לא נמצא. רענן/י את האפליקציה.' }],
  [/Choose a unit/, { fr: 'Choisissez une unité.', he: 'בחר/י יחידה.' }]
];

let LANG = 'en';
function t(key, vars) {
  let s = (TEXT[LANG] && TEXT[LANG][key] !== undefined) ? TEXT[LANG][key] : (TEXT.en[key] !== undefined ? TEXT.en[key] : key);
  if (vars && typeof s === 'string') Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
  return s;
}
function tServer(msg) {
  if (LANG === 'en') return msg;
  const hit = SERVER_MSG.find(([re]) => re.test(msg));
  return hit ? hit[1][LANG] : msg;
}
function tType(type) { const k = 'type:' + type; return TEXT.en[k] ? t(k) : type; }
function tUnit(u) { return t('unit:' + u); }
/** 'November 2026' (as sent to the server) → 'novembre 2026' on screen */
function tMonth(m) { const p = String(m).split(' '); const i = TEXT.en.months.indexOf(p[0]); return i < 0 ? m : t('months')[i] + ' ' + p[1]; }
function detectLang() {
  const n = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return n === 'he' || n === 'iw' ? 'he' : n === 'fr' ? 'fr' : 'en';
}
/** Fills every element that has data-t="key" (text) or data-tp="key" (placeholder). */
function applyTexts() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-tp]').forEach(el => { el.placeholder = t(el.dataset.tp); });
}
