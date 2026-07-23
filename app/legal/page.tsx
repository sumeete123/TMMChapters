import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms & Privacy | TMM Chapters",
  description: "Terms of Service and Privacy Policy for The Mastery Mentors chapter operations platform.",
};

const contactEmail = "themasterymentors@gmail.com";

function Logo() {
  return <span className="logo-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

export default function LegalPage() {
  return <main className="legal-page">
    <header className="legal-nav">
      <Link className="brand" href="/"><Logo /><span>The Mastery Mentors</span><small>Chapters</small></Link>
      <Link className="button secondary" href="/">Return to platform</Link>
    </header>

    <div className="legal-shell">
      <header className="legal-hero">
        <span className="tiny-label">Platform policies</span>
        <h1>Terms of Service &amp;<br />Privacy Policy</h1>
        <p className="legal-subtitle">The Mastery Mentors (TMM Chapters)</p>
        <p className="legal-updated">Last updated July 23, 2026</p>
      </header>

      <article className="legal-document">
        <p className="legal-intro">By accessing or using the TMM Chapters platform, including <strong>tmmchapters.vercel.app</strong> and any official or successor deployment, you agree to these Terms of Service and acknowledge this Privacy Policy. If you do not agree, do not use the platform or submit information through it.</p>

        <section>
          <h2><span>01</span> Eligibility and use of the platform</h2>
          <p>The platform is intended for students and authorized volunteers, chapter leaders, and Mastery Mentors team members who apply to create, support, or manage Mastery Mentors chapters. You must use the platform responsibly and lawfully, provide accurate information, and only submit information you are authorized to provide.</p>
        </section>

        <section>
          <h2><span>02</span> Information we collect</h2>
          <p>Depending on how you use the platform, we may collect:</p>
          <ul>
            <li><strong>Application and contact information:</strong> names, email addresses, phone numbers, city, state, province or country, school or organization name, intended student reach, chapter plans, experience, and information about additional team members or advisors.</li>
            <li><strong>Chapter operations information:</strong> volunteer rosters and contact details, executive-board rosters, assignments, weekly reports, student reach and impact totals, events, attendance, outcomes, supporting documents or links, demotion requests, and event photos.</li>
            <li><strong>Administrative information:</strong> application and chapter status, feedback, support requests, review history, and internal ratings or notes used by authorized Mastery Mentors team members.</li>
            <li><strong>Technical and access information:</strong> session, security, and diagnostic information needed to authenticate users, operate the platform, prevent abuse, and troubleshoot problems.</li>
          </ul>
        </section>

        <section>
          <h2><span>03</span> How we use information</h2>
          <p>We use collected information to review and manage chapter applications; communicate with applicants and chapter teams; provide secure platform access; operate, support, and evaluate chapters; manage volunteers, executive teams, assignments, reports, events, and requests; measure organizational impact; improve the platform; and protect the platform and its users from misuse.</p>
        </section>

        <section>
          <h2><span>04</span> Applications and approval</h2>
          <p>Submitting an application does not guarantee approval. Mastery Mentors may approve, decline, request more information about, or close an application at its discretion. Approved chapters must continue to follow Mastery Mentors requirements and these terms.</p>
        </section>

        <section>
          <h2><span>05</span> Data sharing and public information</h2>
          <p>We do not sell personal information. We may share information with authorized Mastery Mentors team members and service providers that host, store, secure, or help operate the platform, only as reasonably necessary to provide those services. We may also disclose information when required by law or when reasonably necessary to protect the rights, safety, and security of Mastery Mentors, platform users, or others.</p>
          <p>We may publish aggregated or non-identifying impact information, such as the total number of chapters or students reached. A chapter name or general location may be displayed publicly only with authorization or after notice to the chapter. Personal contact details, private reports, internal notes, and access codes are not intended for public display.</p>
        </section>

        <section>
          <h2><span>06</span> Photos and submitted content</h2>
          <p>If you upload a photo or other content, you confirm that you have permission to provide it and allow Mastery Mentors to use it for chapter operations, impact tracking, and authorized organizational communications. Photos must not reveal sensitive information or contain unlawful, harmful, or inappropriate content.</p>
          <p>When a photo includes a minor, the uploader is responsible for obtaining any consent required from the participant, parent or guardian, school, or organization before uploading it. Do not upload a photo if the required permission has not been obtained.</p>
        </section>

        <section>
          <h2><span>07</span> Data protection and retention</h2>
          <p>We use reasonable administrative and technical safeguards and limit access to authorized people. However, no online system can be guaranteed completely secure. We retain information for as long as reasonably necessary to operate and support chapters, maintain organizational records, resolve disputes, meet legal obligations, and protect platform security. Information may then be deleted or de-identified.</p>
        </section>

        <section>
          <h2><span>08</span> User responsibilities and conduct</h2>
          <p>You agree to provide accurate and honest information; avoid spam, duplicate, or misleading submissions; protect chapter and administrator access codes; submit only information and photos you are authorized to share; and represent Mastery Mentors appropriately.</p>
          <p>You may not use the platform to break the law, impersonate another person, harass others, infringe intellectual-property or privacy rights, upload malicious or inappropriate content, attempt unauthorized access, interfere with security, or disrupt the platform.</p>
        </section>

        <section>
          <h2><span>09</span> Suspension, removal, and chapter status</h2>
          <p>Mastery Mentors may reject or close an application, remove submitted content, restrict access, or suspend or deactivate a chapter that violates these terms or community standards; provides false or misleading information; misrepresents the organization; creates safety or privacy concerns; or remains inactive.</p>
        </section>

        <section>
          <h2><span>10</span> Children’s privacy</h2>
          <p>The platform is not directed to children under 13. Children under 13 should not submit personal information through the platform without verifiable permission from a parent or legal guardian. We do not knowingly collect personal information from children under 13 without the consent required by law. If you believe a child under 13 submitted personal information without appropriate consent, contact us so we can review and delete it as appropriate.</p>
        </section>

        <section>
          <h2><span>11</span> Platform availability and changes</h2>
          <p>We may update, modify, suspend, or discontinue any part of the platform at any time. We may also change features, access requirements, or chapter processes. We will try to provide reasonable notice when a change materially affects approved chapters, but continuous availability is not guaranteed.</p>
        </section>

        <section>
          <h2><span>12</span> Disclaimers and limitation of liability</h2>
          <p>The platform is provided “as is” and “as available.” To the fullest extent permitted by law, Mastery Mentors disclaims implied warranties and is not liable for indirect, incidental, special, consequential, or punitive damages arising from use of or inability to use the platform. Nothing in these terms limits liability that cannot lawfully be limited.</p>
        </section>

        <section>
          <h2><span>13</span> Your choices and requests</h2>
          <p>You may request access to, correction of, or deletion of your personal information by contacting us. We may need to verify your identity or authority before completing a request, and we may retain limited information when reasonably necessary for legal, security, fraud-prevention, or operational recordkeeping purposes.</p>
        </section>

        <section>
          <h2><span>14</span> Changes to these policies</h2>
          <p>We may update these Terms of Service and Privacy Policy. The “Last updated” date identifies the current version. When practical, we will provide notice of material changes. Continued use of the platform after an update takes effect means you accept the revised terms.</p>
        </section>

        <section>
          <h2><span>15</span> Contact</h2>
          <p>For questions, privacy requests, corrections, or deletion requests, email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
        </section>

        <aside className="legal-acknowledgment">
          <span className="tiny-label">Acknowledgment</span>
          <p>By submitting an application or using the platform, you acknowledge that you have read and agree to these Terms of Service and Privacy Policy.</p>
        </aside>
      </article>
    </div>

    <footer className="legal-footer">
      <span>© 2026 The Mastery Mentors</span>
      <a href={`mailto:${contactEmail}`}>Contact us</a>
    </footer>
  </main>;
}
