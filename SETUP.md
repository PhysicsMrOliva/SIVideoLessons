# Video Quiz setup (about 30 minutes, one time)

You will set up three things: a Google Sheet with a small script (the backend), a Google sign-in ID, and a GitHub Pages site.

## 1. Google Sheet and script
1. Create a new Google Sheet. Name it "Video Quiz Data".
2. In the Sheet, open **Extensions > Apps Script**.
3. Delete the starter code and paste in everything from `apps-script/Code.gs`.
4. At the top, set `TEACHER_EMAIL` to your school Google address. Leave `CLIENT_ID` for step 2.
5. Do not deploy yet.

## 2. Google sign-in ID (OAuth client)
1. Go to https://console.cloud.google.com and create a project (any name).
2. **APIs & Services > OAuth consent screen**. Choose **Internal** if you can (limits sign-in to your school domain and avoids Google's review). If Internal is not offered, choose External and add the basic app info.
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**. Type: **Web application**.
4. Under **Authorized JavaScript origins**, add `https://YOUR-GITHUB-USERNAME.github.io` (no path, no trailing slash).
5. Create it, then copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
6. Paste the Client ID into `CLIENT_ID` in Code.gs and into `config.js`.

## 3. Deploy the script
1. In Apps Script: **Deploy > New deployment > Web app**.
2. Execute as: **Me**. Who has access: **Anyone**. (Anyone can reach the URL, but every request must carry a valid Google sign-in, and students must be on your roster.)
3. Approve the permissions when asked. Copy the **Web app URL**.
4. Paste it into `config.js` as `API_URL`.
5. Whenever you change Code.gs later: **Deploy > Manage deployments > edit > New version**.

## 4. GitHub Pages
1. Create a GitHub repository and upload `index.html`, `teacher.html`, `style.css`, `shared.js` and `config.js`. Do not upload anything from the Sheet.
2. **Settings > Pages**: deploy from the `main` branch, root folder.
3. Open `https://YOUR-USERNAME.github.io/REPO/teacher.html` and sign in.

## 5. First use
1. **Roster** tab: paste or upload your class list (name, email, optional Canvas ID) and save.
2. **Build** tab: paste a YouTube link, pause the video, add questions, notes and cuts. Tick "Open to students" and save.
3. Copy the student link into a Canvas assignment.
4. **Grade** tab: score open-ended answers; multiple choice is graded automatically on submit. Download the CSV and import it in Canvas.

## Notes
- All data lives in your Sheet (tabs: Assignments, Roster, Responses, Grades). Keep the repo free of student data.
- Google sign-ins expire after about an hour. Students are asked to sign in again and their progress is kept.
- Cuts are skipped by the player; the video still exists on YouTube. Videos with embedding disabled will not play.
- To let a student retake, open the Responses tab in the Sheet and delete their row.
