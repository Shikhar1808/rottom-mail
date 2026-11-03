import type { ReactNode } from 'react';
import { Link } from 'react-router';

// Google needs a public privacy policy before the login can be opened to everyone.
// shortcut: the contact is the repo owner's GitHub profile; swap in an email address before publishing the Google app.
const CONTACT = { label: 'github.com/Shikhar1808', href: 'https://github.com/Shikhar1808' };

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mt-8">
    <h2 className="text-lg font-semibold">{title}</h2>
    <p className="mt-2 leading-relaxed">{children}</p>
  </section>
);

export function Privacy() {
  return (
    <div className="min-h-screen">
      <div className="airmail h-2" />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <Link to="/" className="text-xl font-bold tracking-tight">
          rottom-mail
        </Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-muted">Last updated 3 November 2026</p>

        <Section title="What we get from Google">
          When you sign in with Google, we receive your name, email address and profile photo. We use them only to sign you in and to show who is
          signed in. We can’t see your Gmail, contacts or anything else in your Google account.
        </Section>
        <Section title="What you give us">
          The campaigns you schedule: the subject, the body, and the lead email addresses from the file you upload. We store them to send each
          email on time and to show you what was sent.
        </Section>
        <Section title="Where your emails go">
          Every email goes to Ethereal, a test mail service from the makers of Nodemailer. Ethereal catches the messages and never delivers them
          to the people on your list.
        </Section>
        <Section title="Slack">
          If you connect Slack, we store the address of the channel you picked, encrypted, and use it only to post alerts about your sends. You can
          disconnect at any time.
        </Section>
        <Section title="Cookies">
          One cookie keeps you signed in for up to 7 days, and a short-lived one protects the Google sign-in step. There are no advertising or
          tracking cookies.
        </Section>
        <Section title="Who else sees your data">
          We don’t sell or share your data. It’s stored on the server that runs this site. Google, Ethereal and Slack (if you connect it) each
          receive only what their part needs: sign-in, the test emails, and the alerts.
        </Section>
        <Section title="Deleting your data">
          Contact us at{' '}
          <a href={CONTACT.href} className="text-airmail underline">
            {CONTACT.label}
          </a>{' '}
          and we’ll delete your account, campaigns, emails and Slack connection. The send history (when each email was scheduled and sent) is
          kept, because it’s a permanent log that can’t be edited or deleted.
        </Section>
      </main>
    </div>
  );
}
