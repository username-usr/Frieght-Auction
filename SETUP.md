# Setup Instructions for Ram Nath Freight Bidding Platform

This guide walks you through setting up the backend infrastructure for the Ram Nath Freight Bidding Platform.

## Prerequisites

- Google Account (Gmail)
- GitHub Account (for hosting)

## Step 1: Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet.
2. Name it "Ram Nath Freight Bidding Platform".
3. Create three tabs: **Loads**, **Bids**, **Carriers**.

### Loads Tab Columns
Add the following column headers in row 1:
- Load ID
- Type of Goods
- Weight
- Size
- Origin
- Destination
- Date Needed

### Bids Tab Columns
Add the following column headers in row 1:
- Bid ID
- Load ID
- Carrier ID
- Amount
- Date Submitted

### Carriers Tab Columns
Add the following column headers in row 1:
- Carrier ID
- Name
- Contact
- Rating

4. Note the **Spreadsheet ID** from the URL (the long string between `/d/` and `/edit`).

## Step 2: Create Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Note the **Project ID**.

## Step 3: Enable Google Sheets API

1. In the Google Cloud Console, go to "APIs & Services" > "Library".
2. Search for "Google Sheets API" and enable it.

## Step 4: Create OAuth 2.0 Client ID

1. Go to "APIs & Services" > "Credentials".
2. Click "Create Credentials" > "OAuth 2.0 Client ID".
3. Choose "Web application" as the application type.
4. For "Authorized JavaScript origins", add:
   - `https://[your-github-username].github.io`
   - `https://[your-github-username].github.io/[repo-name]/`
5. For "Authorized redirect URIs", add:
   - `https://[your-github-username].github.io/[repo-name]/`
6. Note the **Client ID**.

## Step 5: Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen".
2. Choose "External" user type.
3. Fill in the app name, user support email, and developer contact information.
4. Add test users: Enter the Gmail addresses of your dispatchers who will test the app.
5. Save and publish the consent screen.

## Step 6: Update Configuration

1. Copy `config.example.js` to `config.js`.
2. Fill in the following values in `config.js`:
   - `CLIENT_ID`: Your OAuth Client ID
   - `SPREADSHEET_ID`: Your Google Sheet ID

## Step 7: Deploy to GitHub Pages

1. Create a new repository on GitHub with the name you chose.
2. Push this project to the repository.
3. In repository settings, enable GitHub Pages from the main branch.
4. Update the OAuth credentials with the actual GitHub Pages URL if not already done.

## Next Steps

Once setup is complete, proceed to Session 2 for implementing the application code.