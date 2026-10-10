# Mac companion: 11 languages

**Done (web, live on deploy):** the companion window's page (`companion.html`) now speaks
Dutch, Japanese, Chinese, Arabic (right to left) and Hindi, as well as English, Spanish, German,
French, Portuguese and Italian. It switches when the app passes `&lang=nl|ja|zh|ar|hi`.

**Your part (the Mac app, 1.3.6):** the Swift source isn't in any GitHub repo, so only you
can make this change.

1. In `L10n.swift`, add `nl`, `ja`, `zh`, `ar` and `hi` to the supported languages. Do the
   same in the Language menu, and wherever the app builds the companion URL's `&lang=`.
   Today it only passes the original six languages.
2. Paste the translations below for the labels the website and the companion page quote. They
   must match word for word: `scripts/tests/companion-lang.test.js` checks them when the
   Swift file is on the machine.
3. Send me `L10n.swift` and I'll translate every other string in it the same way.
4. Build, sign, notarize and release as usual (`scripts/mac-release/release-companion.sh`).
   Older apps keep working: with no `&lang=`, the page stays in English.

| English | Nederlands | 日本語 | 中文 | العربية | हिन्दी |
|---|---|---|---|---|---|
| Disconnect Account (Re-pair) | Account ontkoppelen (opnieuw koppelen) | アカウントの接続を解除（再接続） | 断开账户（重新配对） | قطع اتصال الحساب (إعادة الربط) | खाता डिस्कनेक्ट करें (फिर से जोड़ें) |
| Connect to PollSlide | Verbinden met PollSlide | PollSlide に接続 | 连接到 PollSlide | الاتصال بـ PollSlide | PollSlide से कनेक्ट करें |
| ▶ Start Auto-Show (QR detect) | ▶ Automatisch tonen starten (QR-herkenning) | ▶ 自動表示を開始（QR 検出） | ▶ 开始自动显示（识别二维码） | ▶ بدء العرض التلقائي (اكتشاف QR) | ▶ ऑटो-शो शुरू करें (QR पहचान) |
| ■ Stop Auto-Show (QR detect) | ■ Automatisch tonen stoppen (QR-herkenning) | ■ 自動表示を停止（QR 検出） | ■ 停止自动显示（识别二维码） | ■ إيقاف العرض التلقائي (اكتشاف QR) | ■ ऑटो-शो बंद करें (QR पहचान) |
| Enter code | Voer de code in | コードを入力 | 输入代码 | أدخل الرمز | कोड डालें |
| Connect | Verbinden | 接続 | 连接 | اتصال | कनेक्ट करें |
| Connected! | Verbonden! | 接続しました！ | 已连接！ | تم الاتصال! | कनेक्ट हो गया! |
| This code has expired. Generate a new one. | Deze code is verlopen. Maak een nieuwe. | このコードは期限切れです。新しいコードを発行してください。 | 此代码已过期，请生成新代码。 | انتهت صلاحية هذا الرمز. أنشئ رمزًا جديدًا. | यह कोड समाप्त हो गया है। नया कोड बनाएँ। |
| Invalid code. Check it and try again. | Ongeldige code. Controleer hem en probeer het opnieuw. | コードが正しくありません。確認してもう一度お試しください。 | 代码无效，请检查后重试。 | رمز غير صالح. تحقّق منه وحاول مرة أخرى. | अमान्य कोड। जाँचें और फिर कोशिश करें। |
| Connection error. Check your internet. | Verbindingsfout. Controleer je internet. | 接続エラーです。インターネット接続を確認してください。 | 连接错误，请检查网络。 | خطأ في الاتصال. تحقّق من الإنترنت. | कनेक्शन में त्रुटि। अपना इंटरनेट जाँचें। |

Until the app is updated, a Mac set to one of the new languages shows the app's menus in
English. In the companion window's messages, the quoted menu names stay in English so they
match what's on screen.

## PowerPoint add-in (PollSlide LIVE)

Ready, but **not applied**. Microsoft is still reviewing the add-in, and changing it would
restart the review. The day it's approved:

```
rm SUBMIT-TO-MICROSOFT/REVIEW-FREEZE.json
node scripts/appsource/apply-addin-languages.js --write
node scripts/qa.js
```

The manifest doesn't change, so no resubmission is needed. The add-in follows PowerPoint's own
display language.
