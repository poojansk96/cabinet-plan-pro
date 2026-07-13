# Welcome to your Lovable project

## 🔐 Security & Secrets

All secrets are loaded from environment variables — none are hardcoded in the source.

- **Frontend (`VITE_*`) values are public.** They are inlined into the browser bundle at build time. Only put public-safe values here: the Supabase URL and the **anon/publishable** key. The anon key is safe client-side **only when Row Level Security (RLS) is enabled on every table**. This app currently stores data in `localStorage` and has no exposed database tables — enable RLS before adding any.
- **Never** place the `SUPABASE_SERVICE_ROLE_KEY`, database connection string, or any private API key (Gemini, OpenAI, Anthropic, Dialagram, Stripe secret, etc.) in a `VITE_`-prefixed variable or anywhere in client code. These live only as backend/edge-function secrets.
- Copy `.env.example` to `.env` and fill in your own values. `.env` is git-ignored.

### ⚠️ Rotate previously-committed secrets

If any real secret was ever hardcoded or committed to `.env` in the past, **that value still lives in git history** even after this cleanup. Rotate/regenerate any such credential immediately (Supabase keys, Gemini/OpenAI/Anthropic/Dialagram keys, etc.) — treat any previously committed value as compromised.



## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
