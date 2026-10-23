const PDF_URL = process.env.PDF_URL || "https://qtbrpqyohcpqeieyjwgg.supabase.co/storage/v1/object/public/echo-assets/echo-automation-case-study.pdf";

const esc = s => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let d;
  try { d = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad request' }; }
  if (!(d.elapsed >= 1000)) { console.log('Too fast or no timer, email skipped:', d.elapsed); return { statusCode: 200, body: 'ok' }; } // bot check: modal must be open 1s+

  const name = String(d.name || '').trim().slice(0, 100);
  const email = String(d.email || '').trim().slice(0, 200);
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { statusCode: 400, body: 'Invalid input' };


  const from = process.env.FROM_EMAIL || 'Echo <onboarding@resend.dev>';
  const send = payload => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  // Fetch the PDF ourselves so a broken link fails loudly instead of silently
  let pdf;
  try {
    const r = await fetch(PDF_URL);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    pdf = Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch (err) {
    console.error('PDF fetch failed:', err.message);
    await send({
      from,
      to: process.env.TO_EMAIL,
      subject: 'ALERT: the PDF link is broken',
      html: '<p>The PDF link failed (' + esc(err.message) + '). ' + esc(name) + ' (' + esc(email) + ') did not get their PDF.</p>'
    }).catch(() => {});
    return { statusCode: 502, body: 'PDF unavailable' };
  }

  // 1. Send the PDF to the visitor
  const toVisitor = await send({
    from,
    to: email,
    subject: 'Your PDF: real client designs from Echo',
    html: `<p>Hi ${esc(name)},</p>
           <p>Here's the PDF of real client designs. It's attached to this email.</p>
           <p>Reply to this email with any questions.</p>`,
    attachments: [{ filename: 'Echo-client-designs.pdf', content: pdf }]
  });
  if (!toVisitor.ok) {
    console.error('Resend error:', await toVisitor.text());
    return { statusCode: 502, body: 'Send failed' };
  }

  // 2. Notify you (a failure here shouldn't break the visitor's experience)
  try {
    await send({
      from,
      to: process.env.TO_EMAIL,
      reply_to: email,
      subject: `New PDF request from ${name}`,
      html: `<p><b>Name:</b> ${esc(name)}</p><p><b>Email:</b> ${esc(email)}</p>`
    });
  } catch (err) { console.error('Notify failed:', err.message); }

  return { statusCode: 200, body: 'ok' };
};
