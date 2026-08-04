// ─── Email Templates ────────────────────────────────────────────────────────

export function welcomeEmailHtml(
  ownerName: string,
  businessName: string,
  resetLink: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Tropx Wholesale</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 2rem 2.5rem;
      text-align: center;
    }
    .header h1 {
      color: #ffffff; font-size: 1.5rem;
      margin: 0; font-weight: 700;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.875rem;
    }
    .body { padding: 2.5rem; }
    .greeting {
      font-size: 1.1rem; color: #1c1c1c;
      margin-bottom: 1rem;
    }
    .message {
      color: #444; line-height: 1.7;
      margin-bottom: 1.5rem; font-size: 0.95rem;
    }
    .highlight-box {
      background: #f0f7ff;
      border-left: 4px solid #16588e;
      border-radius: 0 8px 8px 0;
      padding: 1.25rem 1.5rem; margin-bottom: 2rem;
    }
    .highlight-box p {
      margin: 0; color: #0a2d4a;
      font-size: 0.9rem; line-height: 1.6;
    }
    .btn {
      display: block; width: fit-content;
      margin: 0 auto 2rem; background: #0a2d4a;
      color: #ffffff !important;
      text-decoration: none;
      padding: 0.875rem 2.5rem; border-radius: 8px;
      font-weight: 600; font-size: 1rem;
      text-align: center;
    }
    .feature-item {
      display: flex; align-items: flex-start;
      gap: 0.75rem; margin-bottom: 0.5rem;
    }
    .feature-icon {
      color: #1a7c4a; font-weight: 700;
      font-size: 1rem;
    }
    .feature-text {
      color: #444; font-size: 0.875rem;
      line-height: 1.5;
    }
    .divider {
      border: none; border-top: 1px solid #eee;
      margin: 1.5rem 0;
    }
    .footer {
      background: #f8f9fa;
      padding: 1.5rem 2.5rem; text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.8rem;
      margin: 0.25rem 0; line-height: 1.6;
    }
    .footer a { color: #16588e; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Your Wholesale Partner</p>
    </div>
    <div class="body">
      <p class="greeting">Welcome, ${ownerName}! 🎉</p>
      <p class="message">
        Congratulations — <strong>${businessName}</strong> has been
        approved as a Tropx Wholesale partner. We're excited to
        work with you and help keep your shelves stocked with
        quality products at competitive prices.
      </p>
      <div class="highlight-box">
        <p>
          <strong>Your account is ready.</strong> Click the button
          below to set your password and access your wholesale
          portal. This link expires in 24 hours.
        </p>
      </div>
      <a href="${resetLink}" class="btn">
        Set Up Your Account →
      </a>
      <div style="margin-bottom: 2rem;">
        <p style="color:#0a2d4a;font-size:0.95rem;font-weight:600;">
          What you can do in your portal:
        </p>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            Browse our full product catalog with wholesale pricing
          </span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            Place and track orders anytime, 24/7
          </span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">✓</span>
          <span class="feature-text">
            View your order history and payment records
          </span>
        </div>
      </div>
      <hr class="divider">
      <p class="message" style="font-size:0.875rem;color:#666;">
        If you have any questions, don't hesitate to reach out.
        We're here to help.
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca
      </a></p>
      <p style="margin-top:1rem;font-size:0.75rem;">
        You received this email because your wholesale access
        request was approved.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function passwordResetEmailHtml(resetLink: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 2rem 2.5rem;
      text-align: center;
    }
    .header h1 {
      color: #ffffff; font-size: 1.5rem;
      margin: 0; font-weight: 700;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.875rem;
    }
    .body { padding: 2.5rem; }
    .message {
      color: #444; line-height: 1.7;
      margin-bottom: 1.5rem; font-size: 0.95rem;
    }
    .highlight-box {
      background: #fff8f0;
      border-left: 4px solid #c9952a;
      border-radius: 0 8px 8px 0;
      padding: 1.25rem 1.5rem; margin-bottom: 2rem;
    }
    .highlight-box p {
      margin: 0; color: #6b4c00;
      font-size: 0.9rem; line-height: 1.6;
    }
    .btn {
      display: block; width: fit-content;
      margin: 0 auto 2rem; background: #0a2d4a;
      color: #ffffff !important;
      text-decoration: none;
      padding: 0.875rem 2.5rem; border-radius: 8px;
      font-weight: 600; font-size: 1rem;
      text-align: center;
    }
    .divider {
      border: none; border-top: 1px solid #eee;
      margin: 1.5rem 0;
    }
    .footer {
      background: #f8f9fa;
      padding: 1.5rem 2.5rem; text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.8rem;
      margin: 0.25rem 0; line-height: 1.6;
    }
    .footer a { color: #16588e; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Your Wholesale Partner</p>
    </div>
    <div class="body">
      <p class="message" style="font-size:1.05rem;
        font-weight:600;color:#0a2d4a;">
        Password Reset Request
      </p>
      <p class="message">
        We received a request to reset the password for your
        Tropx Wholesale account. Click the button below to
        choose a new password.
      </p>
      <div class="highlight-box">
        <p>
          ⏱ This link expires in <strong>1 hour</strong>.
          If you didn't request a password reset, you can
          safely ignore this email.
        </p>
      </div>
      <a href="${resetLink}" class="btn">
        Reset My Password →
      </a>
      <hr class="divider">
      <p class="message" style="font-size:0.875rem;color:#666;">
        If the button doesn't work, copy and paste this link:<br>
        <a href="${resetLink}"
          style="color:#16588e;word-break:break-all;">
          ${resetLink}
        </a>
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca
      </a></p>
      <p style="margin-top:1rem;font-size:0.75rem;">
        If you did not request a password reset, please
        ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function contactInquiryEmailHtml(
  name: string,
  email: string,
  phone: string,
  businessName: string,
  message: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont,
        'Segoe UI', sans-serif;
      background: #f5f5f5; margin: 0; padding: 0;
    }
    .wrapper {
      max-width: 580px; margin: 40px auto;
      background: #ffffff; border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .header {
      background: #0a2d4a; padding: 1.5rem 2rem;
    }
    .header h1 {
      color: #ffffff; font-size: 1.1rem; margin: 0;
    }
    .header p {
      color: #f0c040; margin: 0.25rem 0 0;
      font-size: 0.8rem;
    }
    .body { padding: 2rem; }
    .field {
      margin-bottom: 1.25rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid #f0f0f0;
    }
    .field:last-child { border-bottom: none; }
    .label {
      font-size: 0.75rem; font-weight: 600;
      color: #8a94a6; text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 0.35rem;
    }
    .value {
      font-size: 0.95rem; color: #1c1c1c;
      line-height: 1.6;
    }
    .footer {
      background: #f8f9fa; padding: 1rem 2rem;
      text-align: center;
    }
    .footer p {
      color: #8a94a6; font-size: 0.78rem; margin: 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>New Contact Inquiry</h1>
      <p>Tropx Wholesale — tropxwholesale.ca</p>
    </div>
    <div class="body">
      <div class="field">
        <div class="label">Name</div>
        <div class="value">${name ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Business Name</div>
        <div class="value">${businessName ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Email</div>
        <div class="value">${email ?? "—"}</div>
      </div>
      <div class="field">
        <div class="label">Phone</div>
        <div class="value">${phone ?? "Not provided"}</div>
      </div>
      <div class="field">
        <div class="label">Message</div>
        <div class="value">${message ?? "—"}</div>
      </div>
    </div>
    <div class="footer">
      <p>Sent from tropxwholesale.ca contact form</p>
    </div>
  </div>
</body>
</html>`;
}

export function employeeInvitationEmailHtml(
  firstName: string,
  roleLabel: string,
  email: string,
  tempPassword: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Your Staff Account</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont,
      'Segoe UI', sans-serif; background:#f5f5f5; 
      margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px; overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a; padding:2rem 2.5rem;
      text-align:center; }
    .header h1 { color:#fff; font-size:1.5rem; margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.875rem; }
    .body { padding:2.5rem; }
    .message { color:#444; line-height:1.7;
      margin-bottom:1.5rem; font-size:0.95rem; }
    .credentials-box { background:#f0f7ff;
      border-left:4px solid #16588e;
      border-radius:0 8px 8px 0;
      padding:1.25rem 1.5rem; margin-bottom:2rem; }
    .credentials-box p { margin:0.25rem 0; 
      font-size:0.9rem; color:#0a2d4a; }
    .credentials-box strong { font-family:monospace;
      font-size:1rem; }
    .btn { display:block; width:fit-content;
      margin:0 auto 2rem; background:#0a2d4a;
      color:#fff !important; text-decoration:none;
      padding:0.875rem 2.5rem; border-radius:8px;
      font-weight:600; font-size:1rem; text-align:center; }
    .footer { background:#f8f9fa; padding:1.5rem 2.5rem;
      text-align:center; }
    .footer p { color:#8a94a6; font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e; text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Tropx Wholesale</h1>
      <p>Staff Portal Access</p>
    </div>
    <div class="body">
      <p class="message">
        Hi ${firstName}, a staff account has been created 
        for you on the Tropx Wholesale platform. 
        Your role is <strong>${roleLabel}</strong>.
      </p>
      <div class="credentials-box">
        <p>Email: <strong>${email}</strong></p>
        <p>Temporary Password: 
          <strong>${tempPassword}</strong></p>
      </div>
      <a href="https://tropxwholesale.ca/login" class="btn">
        Sign In →
      </a>
      <p class="message" style="font-size:0.875rem;
        color:#666;">
        Please change your password after signing in.
        If you have questions, contact your administrator.
      </p>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p><a href="https://tropxwholesale.ca">
        tropxwholesale.ca</a></p>
    </div>
  </div>
</body>
</html>`;
}

export function orderNotificationEmailHtml(
  orderNumber: string,
  customerName: string,
  customerPhone: string,
  total: string,
  itemsHtml: string,
  deliveryType: string,
  serviceAreaName: string,
  source: string
): string {
  const deliveryLabel = deliveryType === "pickup" ?
    "📦 Pickup" : "🚚 Delivery";
  const sourceLabel = source === "customer_portal" ?
    "Customer Portal" : "Admin";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.85rem; }
    .body { padding:1.75rem 2rem; }
    .order-num { font-family:monospace;
      font-size:1.5rem; font-weight:800;
      color:#0a2d4a; margin:0 0 1rem; }
    .meta-grid { display:grid;
      grid-template-columns:1fr 1fr;
      gap:1rem; margin-bottom:1.5rem; }
    .meta-item .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      letter-spacing:0.05em; color:#8a94a6;
      margin-bottom:0.25rem; }
    .meta-item .value { font-size:0.9rem;
      color:#1c1c1c; font-weight:500; }
    table { width:100%; border-collapse:collapse;
      margin-bottom:1rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px; font-size:0.75rem;
      font-weight:700; text-transform:uppercase;
      color:white; text-align:left; }
    .total-row { background:#f8f9fa;
      border-top:2px solid #0a2d4a; }
    .total-row td { padding:12px;
      font-weight:700; font-size:1rem;
      color:#0a2d4a; }
    .action-btn { display:inline-block;
      margin-top:1.5rem; background:#0a2d4a;
      color:#fff !important; text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🛒 New Order Received</h1>
      <p>Tropx Wholesale Admin Alert</p>
    </div>
    <div class="body">
      <div class="order-num">${orderNumber}</div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">Customer</div>
          <div class="value">${customerName}</div>
        </div>
        <div class="meta-item">
          <div class="label">Phone</div>
          <div class="value">
            ${customerPhone || "—"}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Delivery</div>
          <div class="value">${deliveryLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Service Area</div>
          <div class="value">
            ${serviceAreaName || "—"}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Source</div>
          <div class="value">${sourceLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Order Total</div>
          <div class="value" 
            style="font-size:1.1rem;font-weight:700;
              color:#0a2d4a;">
            ${total}
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tr class="total-row">
          <td colspan="2">Order Total</td>
          <td style="text-align:right;">${total}</td>
        </tr>
      </table>
      <a href="https://tropxwholesale.ca/admin/orders"
        class="action-btn">
        View Order →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

export function accessRequestNotificationEmailHtml(
  businessName: string,
  ownerName: string,
  email: string,
  phone: string,
  businessType: string,
  address: any
): string {
  const addressStr = address ?
    [address.city, address.province, address.country]
      .filter(Boolean).join(", ") :
    "—";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#f0c040; margin:0.25rem 0 0;
      font-size:0.85rem; }
    .body { padding:1.75rem 2rem; }
    .business-name { font-size:1.375rem;
      font-weight:800; color:#0a2d4a;
      margin:0 0 1.25rem; }
    .field { margin-bottom:1rem;
      padding-bottom:1rem;
      border-bottom:1px solid #f0f0f0; }
    .field:last-of-type { border-bottom:none; }
    .label { font-size:0.7rem; font-weight:700;
      text-transform:uppercase; letter-spacing:0.05em;
      color:#8a94a6; margin-bottom:0.25rem; }
    .value { font-size:0.925rem; color:#1c1c1c; }
    .action-btn { display:inline-block;
      margin-top:1.5rem; background:#1a7c4a;
      color:#fff !important; text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🏪 New Access Request</h1>
      <p>Tropx Wholesale — Review Required</p>
    </div>
    <div class="body">
      <div class="business-name">${businessName}</div>
      <div class="field">
        <div class="label">Owner Name</div>
        <div class="value">${ownerName || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Email</div>
        <div class="value">${email || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Phone</div>
        <div class="value">${phone || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Business Type</div>
        <div class="value">${businessType || "—"}</div>
      </div>
      <div class="field">
        <div class="label">Location</div>
        <div class="value">${addressStr}</div>
      </div>
      <a href="https://tropxwholesale.ca/admin/access-requests"
        class="action-btn">
        Review Request →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

export function returnNotificationEmailHtml(
  returnNumber: string,
  orderNumber: string,
  customerName: string,
  typeLabel: string,
  amount: string,
  reasonLabel: string,
  reason: string,
  itemsHtml: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#c9952a;
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#fff9ee; margin:0.25rem 0 0;
      font-size:0.85rem; opacity:0.85; }
    .body { padding:1.75rem 2rem; }
    .return-num { font-family:monospace;
      font-size:1.375rem; font-weight:800;
      color:#0a2d4a; margin:0 0 0.25rem; }
    .order-ref { font-size:0.875rem; color:#8a94a6;
      margin:0 0 1.25rem; }
    .meta-grid { display:grid;
      grid-template-columns:1fr 1fr;
      gap:1rem; margin-bottom:1.5rem; }
    .meta-item .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      letter-spacing:0.05em; color:#8a94a6;
      margin-bottom:0.25rem; }
    .meta-item .value { font-size:0.9rem;
      color:#1c1c1c; font-weight:500; }
    .reason-box { background:#fff8f0;
      border-left:4px solid #c9952a;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem; margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700; text-transform:uppercase;
      color:#8a94a6; margin-bottom:0.375rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    table { width:100%; border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px; font-size:0.75rem;
      font-weight:700; text-transform:uppercase;
      color:white; text-align:left; }
    .action-btn { display:inline-block;
      background:#c9952a; color:#fff !important;
      text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>↩️ Return Submitted</h1>
      <p>Tropx Wholesale — Action Required</p>
    </div>
    <div class="body">
      <div class="return-num">${returnNumber}</div>
      <div class="order-ref">
        Order: ${orderNumber}
      </div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">Customer</div>
          <div class="value">${customerName}</div>
        </div>
        <div class="meta-item">
          <div class="label">Return Type</div>
          <div class="value">${typeLabel}</div>
        </div>
        <div class="meta-item">
          <div class="label">Return Value</div>
          <div class="value"
            style="font-size:1.1rem;font-weight:700;
              color:#e7222e;">
            ${amount}
          </div>
        </div>
        <div class="meta-item">
          <div class="label">Reason</div>
          <div class="value">${reasonLabel}</div>
        </div>
      </div>
      <div class="reason-box">
        <div class="label">Customer Description</div>
        <div class="value">${reason || "—"}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Value
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <a href="https://tropxwholesale.ca/admin/returns"
        class="action-btn">
        Review Return →
      </a>
    </div>
    <div class="footer">
      <p>Tropx Wholesale Admin Notification</p>
    </div>
  </div>
</body>
</html>`;
}

export function backInStockEmailHtml(
  customerName: string,
  productName: string,
  productSku: string,
): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:580px;margin:40px auto;background:#fff;border-radius:12px;
    overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1a7c4a;padding:2rem 2.5rem;text-align:center;">
      <span style="font-size:2.5rem;display:block;margin-bottom:0.5rem;">📦</span>
      <h1 style="color:#fff;font-size:1.375rem;margin:0;font-weight:800;">Back in Stock!</h1>
      <p style="color:#fff;margin:0.25rem 0 0;font-size:0.875rem;opacity:0.85;">
        The item you wanted is available again
      </p>
    </div>
    <div style="padding:2rem 2.5rem;">
      <p style="font-size:1rem;color:#1c1c1c;margin-bottom:0.75rem;">Hi ${customerName},</p>
      <p style="color:#555;line-height:1.7;font-size:0.95rem;margin-bottom:1.5rem;">
        Good news — <strong>${productName}</strong>${productSku ? ` (SKU ${productSku})` : ""} 
        is back in stock and ready to order. Popular items go quickly, so order soon to secure yours.
      </p>
      <div style="text-align:center;">
        <a href="https://tropxwholesale.ca/portal/catalog" 
           style="display:inline-block;background:#1a7c4a;color:#fff !important;
           text-decoration:none;padding:0.875rem 2.5rem;border-radius:8px;
           font-weight:600;font-size:1rem;">
           Order Now →
        </a>
      </div>
    </div>
    <div style="background:#f8f9fa;padding:1.5rem 2.5rem;text-align:center;">
      <p style="color:#8a94a6;font-size:0.8rem;margin:0.25rem 0;">
        <strong>Tropx Enterprises Inc.</strong><br>Kitchener, Ontario, Canada
      </p>
      <p style="color:#8a94a6;font-size:0.8rem;margin:0.25rem 0;">
        <a href="https://tropxwholesale.ca" style="color:#16588e;text-decoration:none;">tropxwholesale.ca</a>
      </p>
      <p style="margin-top:0.75rem;font-size:0.72rem;color:#9ca3af;">
        You asked to be notified when this item returned. 
        You won't receive further emails about it unless you request again.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function lowStockAlertEmailHtml(
  productName: string,
  productSku: string,
  atp: number,
  threshold: number,
  isOutOfStock: boolean,
  linkedOrderNumber: string | null,
  committedQty = 0
): string {
  const headerColor = isOutOfStock ?
    "#e7222e" : "#c9952a";
  const statusText = isOutOfStock ?
    "Out of Stock" : "Low Stock";
  const emoji = isOutOfStock ? "🔴" : "🟡";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system,
      BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background:#f5f5f5; margin:0; padding:0; }
    .wrapper { max-width:580px; margin:40px auto;
      background:#fff; border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${headerColor};
      padding:1.5rem 2rem; }
    .header h1 { color:#fff; font-size:1.1rem;
      margin:0; }
    .header p { color:#fff; margin:0.25rem 0 0;
      font-size:0.85rem; opacity:0.85; }
    .body { padding:1.75rem 2rem; }
    .product-name { font-size:1.375rem;
      font-weight:800; color:#0a2d4a;
      margin:0 0 0.25rem; }
    .product-sku { font-family:monospace;
      font-size:0.875rem; color:#8a94a6;
      margin:0 0 1.5rem; }
    .stock-display { text-align:center;
      padding:1.5rem; background:#f8f9fa;
      border-radius:10px; margin-bottom:1.5rem; }
    .stock-number { font-size:3rem; font-weight:800;
      color:${headerColor}; line-height:1; }
    .stock-label { font-size:0.875rem; color:#8a94a6;
      margin-top:0.25rem; }
    .threshold-note { font-size:0.875rem;
      color:#8a94a6; margin-top:0.5rem; }
    .context-box { background:#f0f7ff;
      border-left:4px solid #16588e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem; margin-bottom:1.5rem; }
    .context-box p { margin:0; font-size:0.875rem;
      color:#0a2d4a; }
    .action-btn { display:inline-block;
      background:#0a2d4a; color:#fff !important;
      text-decoration:none;
      padding:0.75rem 2rem; border-radius:8px;
      font-weight:600; font-size:0.9rem; }
    .footer { background:#f8f9fa;
      padding:1rem 2rem; text-align:center; }
    .footer p { color:#8a94a6; font-size:0.78rem;
      margin:0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${emoji} ${statusText} Alert</h1>
      <p>Tropx Wholesale Inventory Warning</p>
    </div>
    <div class="body">
      <div class="product-name">${productName}</div>
      <div class="product-sku">SKU: ${productSku}</div>
      <div class="stock-display">
        <div class="stock-number">
          ${atp}
        </div>
        <div class="stock-label">
          units available to promise
        </div>
        <div class="threshold-note">
          Low stock threshold: ${threshold} units
          ${committedQty > 0 ?
    `· ${committedQty} committed to open orders` :
    ""}
        </div>
      </div>
      ${linkedOrderNumber ? `
        <div class="context-box">
          <p>
            This alert was triggered by order
            <strong>${linkedOrderNumber}</strong>.
          </p>
        </div>
      ` : ""}
      <p style="color:#444;font-size:0.9rem;
        margin-bottom:1.5rem;line-height:1.6;">
        ${isOutOfStock ?
    "This product is now <strong>out of stock</strong>. " +
          "Please reorder as soon as possible." :
    "This product is running low. Consider restocking soon."
}
      </p>
      <a href="https://tropxwholesale.ca/admin/products"
        class="action-btn">
        View Products →
      </a>
    </div>
  </div>
</body>
</html>`;
}

export function orderStatusEmailHtml(
  status: string,
  orderNumber: string,
  customerName: string,
  total: string,
  balance: string,
  balanceCents: number,
  itemsHtml: string,
  deliveryType: string,
  deliveryDateStr: string,
  cancellationReason: string
): string {
  const configs: Record<string, {
    headerBg: string;
    emoji: string;
    title: string;
    subtitle: string;
    message: string;
    btnColor: string;
    btnText: string;
  }> = {
    confirmed: {
      headerBg: "#1a7c4a",
      emoji: "✅",
      title: "Order Confirmed",
      subtitle: "Your order has been received",
      message: "Great news! Your order has been " +
        "confirmed and is being prepared. " +
        "We will notify you when it is on its way.",
      btnColor: "#1a7c4a",
      btnText: "View Order →",
    },
    out_for_delivery: {
      headerBg: "#16588e",
      emoji: "🚚",
      title: "Out for Delivery",
      subtitle: "Your order is on its way",
      message: "Your order is on its way to you. " +
        "Please ensure someone is available " +
        "to receive the delivery.",
      btnColor: "#16588e",
      btnText: "View Order →",
    },
    delivered: {
      headerBg: "#0a2d4a",
      emoji: "📦",
      title: "Order Delivered",
      subtitle: "Your order has arrived",
      message: "Your order has been marked as " +
        "delivered. Thank you for your business! " +
        "If you have any issues with your order, " +
        "please contact us.",
      btnColor: "#0a2d4a",
      btnText: "View Invoice →",
    },
    cancelled: {
      headerBg: "#e7222e",
      emoji: "❌",
      title: "Order Cancelled",
      subtitle: "Your order has been cancelled",
      message: "Your order has been cancelled. " +
        "If you have any questions or would like " +
        "to place a new order, please contact us.",
      btnColor: "#e7222e",
      btnText: "Contact Us →",
    },
  };

  const cfg = configs[status] || configs["confirmed"];

  const deliverySection = deliveryDateStr ?
    `<div class="info-box">
      <div class="info-label">
        ${status === "out_for_delivery" ?
    "Expected Delivery" : "Delivery Date"}
      </div>
      <div class="info-value">${deliveryDateStr}</div>
    </div>` : "";

  const cancellationSection = (
    status === "cancelled" && cancellationReason
  ) ?
    `<div class="reason-box">
      <div class="label">Reason</div>
      <div class="value">${cancellationReason}</div>
    </div>` : "";

  const balanceSection = (
    status === "delivered" && balanceCents > 0
  ) ?
    `<div class="balance-box">
      <p>
        <strong>Outstanding Balance: ${balance}</strong>
        <br>
        <span style="font-size:0.875rem;color:#666;">
          Please arrange payment at your earliest
          convenience.
        </span>
      </p>
    </div>` : "";

  const btnHref = status === "cancelled" ?
    "https://tropxwholesale.ca/contact" :
    "https://tropxwholesale.ca/portal/orders";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${cfg.headerBg};
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#fff;margin:0.25rem 0 0;
      font-size:0.875rem;opacity:0.85; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .order-num { font-family:monospace;
      font-size:1.25rem;font-weight:800;
      color:#0a2d4a;margin-bottom:1.5rem; }
    .info-box { background:#f8f9fa;
      border-radius:8px;padding:1rem 1.25rem;
      margin-bottom:1rem; }
    .info-label { font-size:0.7rem;font-weight:700;
      text-transform:uppercase;letter-spacing:0.05em;
      color:#8a94a6;margin-bottom:0.25rem; }
    .info-value { font-size:0.95rem;
      color:#1c1c1c;font-weight:600; }
    .reason-box { background:#fff0f0;
      border-left:4px solid #e7222e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    .balance-box { background:#fff8f0;
      border-left:4px solid #c9952a;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .balance-box p { margin:0;color:#1c1c1c;
      font-size:0.9rem;line-height:1.6; }
    table { width:100%;border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px;font-size:0.75rem;
      font-weight:700;text-transform:uppercase;
      color:white;text-align:left; }
    tbody td { border-bottom:1px solid #f0f0f0; }
    .total-row { background:#f8f9fa; }
    .total-row td { padding:12px;font-weight:700;
      font-size:1rem;color:#0a2d4a; }
    .btn { display:inline-block;
      background:${cfg.btnColor};
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">${cfg.emoji}</span>
      <h1>${cfg.title}</h1>
      <p>${cfg.subtitle}</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">${cfg.message}</p>
      <div class="order-num">
        Order: ${orderNumber}
      </div>
      ${deliverySection}
      ${cancellationSection}
      ${balanceSection}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Total
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tr class="total-row">
          <td colspan="2"
            style="padding:12px;">
            Order Total
          </td>
          <td style="padding:12px;
            text-align:right;">
            ${total}
          </td>
        </tr>
      </table>
      <a href="${btnHref}" class="btn">
        ${cfg.btnText}
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function returnStatusEmailHtml(
  status: string,
  returnNumber: string,
  orderNumber: string,
  customerName: string,
  typeLabel: string,
  amount: string,
  itemsHtml: string,
  rejectionReason: string,
  stockRestored: boolean
): string {
  const isApproved = status === "approved";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:${isApproved ?
    "#1a7c4a" : "#e7222e"};
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#fff;margin:0.25rem 0 0;
      font-size:0.875rem;opacity:0.85; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .ref-row { display:flex;gap:1.5rem;
      margin-bottom:1.5rem;flex-wrap:wrap; }
    .ref-item .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      letter-spacing:0.05em;color:#8a94a6;
      margin-bottom:0.25rem; }
    .ref-item .value { font-size:0.95rem;
      color:#1c1c1c;font-weight:600;
      font-family:monospace; }
    .amount-box { background:${isApproved ?
    "rgba(26,124,74,0.06)" :
    "rgba(231,34,46,0.06)"};
      border-left:4px solid ${isApproved ?
    "#1a7c4a" : "#e7222e"};
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .amount-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .amount-box .value { font-size:1.25rem;
      font-weight:800;
      color:${isApproved ? "#1a7c4a" : "#e7222e"}; }
    .reason-box { background:#fff0f0;
      border-left:4px solid #e7222e;
      border-radius:0 8px 8px 0;
      padding:1rem 1.25rem;margin-bottom:1.5rem; }
    .reason-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .reason-box .value { font-size:0.9rem;
      color:#1c1c1c; }
    table { width:100%;border-collapse:collapse;
      margin-bottom:1.5rem; }
    thead tr { background:#0a2d4a; }
    thead th { padding:10px 12px;font-size:0.75rem;
      font-weight:700;text-transform:uppercase;
      color:white;text-align:left; }
    tbody td { border-bottom:1px solid #f0f0f0; }
    .btn { display:inline-block;
      background:${isApproved ?
    "#1a7c4a" : "#0a2d4a"};
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">
        ${isApproved ? "✅" : "❌"}
      </span>
      <h1>
        Return ${isApproved ? "Approved" : "Not Approved"}
      </h1>
      <p>
        ${isApproved ?
    "Your return has been processed" :
    "We could not approve your return"}
      </p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">
        ${isApproved ?
    "Your return request has been approved. " +
          `A <strong>${typeLabel}</strong> of ` +
          `<strong>${amount}</strong> has been ` +
          "processed for your account." :
    "Unfortunately we were unable to approve " +
          "your return request at this time. " +
          "Please contact us if you have questions."
}
      </p>
      <div class="ref-row">
        <div class="ref-item">
          <div class="label">Return</div>
          <div class="value">${returnNumber}</div>
        </div>
        <div class="ref-item">
          <div class="label">Order</div>
          <div class="value">${orderNumber}</div>
        </div>
      </div>
      ${isApproved ? `
        <div class="amount-box">
          <div class="label">
            ${typeLabel} Amount
          </div>
          <div class="value">${amount}</div>
        </div>
        ${stockRestored ? `
          <p style="font-size:0.875rem;
            color:#666;margin-bottom:1.5rem;">
            ℹ️ The returned items have been added
            back to inventory.
          </p>
        ` : ""}
      ` : `
        ${rejectionReason ? `
          <div class="reason-box">
            <div class="label">Reason</div>
            <div class="value">
              ${rejectionReason}
            </div>
          </div>
        ` : ""}
      `}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;width:60px;">
              Qty
            </th>
            <th style="text-align:right;width:80px;">
              Value
            </th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <a href="https://tropxwholesale.ca/portal/orders"
        class="btn">
        View My Orders →
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function paymentReceiptEmailHtml(
  paymentNumber: string,
  orderNumber: string,
  customerName: string,
  amount: string,
  methodLabel: string,
  referenceNumber: string,
  receivedDate: string,
  balance: string,
  orderTotal: string,
  remainingBalanceCents: number
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1.0">
  <style>
    body { font-family:-apple-system,
      BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#f5f5f5;margin:0;padding:0; }
    .wrapper { max-width:580px;margin:40px auto;
      background:#fff;border-radius:12px;
      overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { background:#0a2d4a;
      padding:2rem 2.5rem;text-align:center; }
    .header .emoji { font-size:2.5rem;
      margin-bottom:0.5rem;display:block; }
    .header h1 { color:#fff;font-size:1.375rem;
      margin:0;font-weight:800; }
    .header p { color:#f0c040;margin:0.25rem 0 0;
      font-size:0.875rem; }
    .body { padding:2rem 2.5rem; }
    .greeting { font-size:1rem;color:#1c1c1c;
      margin-bottom:0.75rem; }
    .message { color:#555;line-height:1.7;
      font-size:0.95rem;margin-bottom:1.5rem; }
    .amount-display { text-align:center;
      padding:1.5rem;background:#f0f7f3;
      border-radius:10px;margin-bottom:1.5rem;
      border:1px solid rgba(26,124,74,0.2); }
    .amount-num { font-size:2.5rem;font-weight:800;
      color:#1a7c4a;line-height:1; }
    .amount-label { font-size:0.875rem;
      color:#8a94a6;margin-top:0.25rem; }
    .details-table { width:100%;
      border-collapse:collapse;
      margin-bottom:1.5rem; }
    .details-table tr { border-bottom:
      1px solid #f0f0f0; }
    .details-table tr:last-child {
      border-bottom:none; }
    .details-table td { padding:0.75rem 0;
      font-size:0.9rem; }
    .details-table td:first-child {
      color:#8a94a6;font-weight:500; }
    .details-table td:last-child {
      color:#1c1c1c;font-weight:600;
      text-align:right; }
    .balance-box { padding:1rem 1.25rem;
      border-radius:8px;margin-bottom:1.5rem;
      background:${remainingBalanceCents > 0 ?
    "rgba(231,34,46,0.06)" :
    "rgba(26,124,74,0.06)"};
      border:1px solid ${remainingBalanceCents > 0 ?
    "rgba(231,34,46,0.2)" :
    "rgba(26,124,74,0.2)"}; }
    .balance-box .label { font-size:0.7rem;
      font-weight:700;text-transform:uppercase;
      color:#8a94a6;margin-bottom:0.25rem; }
    .balance-box .value { font-size:1.125rem;
      font-weight:800;
      color:${remainingBalanceCents > 0 ?
    "#e7222e" : "#1a7c4a"}; }
    .balance-box .sub { font-size:0.8rem;
      color:#8a94a6;margin-top:0.25rem; }
    .btn { display:inline-block;background:#0a2d4a;
      color:#fff !important;text-decoration:none;
      padding:0.875rem 2.5rem;border-radius:8px;
      font-weight:600;font-size:1rem; }
    .footer { background:#f8f9fa;
      padding:1.5rem 2.5rem;text-align:center; }
    .footer p { color:#8a94a6;font-size:0.8rem;
      margin:0.25rem 0; }
    .footer a { color:#16588e;
      text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <span class="emoji">💳</span>
      <h1>Payment Received</h1>
      <p>Tropx Wholesale — Payment Confirmation</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${customerName},</p>
      <p class="message">
        We have received your payment. Here is your
        receipt for your records.
      </p>
      <div class="amount-display">
        <div class="amount-num">${amount}</div>
        <div class="amount-label">
          Payment received
        </div>
      </div>
      <table class="details-table">
        <tr>
          <td>Payment #</td>
          <td style="font-family:monospace;">
            ${paymentNumber}
          </td>
        </tr>
        <tr>
          <td>Order #</td>
          <td style="font-family:monospace;">
            ${orderNumber}
          </td>
        </tr>
        <tr>
          <td>Payment Method</td>
          <td>${methodLabel}</td>
        </tr>
        ${referenceNumber ? `
          <tr>
            <td>Reference #</td>
            <td style="font-family:monospace;">
              ${referenceNumber}
            </td>
          </tr>
        ` : ""}
        <tr>
          <td>Date</td>
          <td>${receivedDate}</td>
        </tr>
        <tr>
          <td>Order Total</td>
          <td>${orderTotal}</td>
        </tr>
      </table>
      <div class="balance-box">
        <div class="label">
          ${remainingBalanceCents > 0 ?
    "Remaining Balance" :
    "Account Status"}
        </div>
        <div class="value">
          ${remainingBalanceCents > 0 ?
    balance : "Paid in Full ✓"}
        </div>
        ${remainingBalanceCents > 0 ? `
          <div class="sub">
            Balance remaining on this order
          </div>
        ` : `
          <div class="sub">
            This order is fully paid — thank you!
          </div>
        `}
      </div>
      <a href="https://tropxwholesale.ca/portal/orders"
        class="btn">
        View My Orders →
      </a>
    </div>
    <div class="footer">
      <p><strong>Tropx Enterprises Inc.</strong><br>
        Kitchener, Ontario, Canada</p>
      <p>
        <a href="https://tropxwholesale.ca">
          tropxwholesale.ca
        </a>
      </p>
      <p style="margin-top:0.75rem;font-size:0.75rem;">
        This is an automated payment confirmation.
        Please keep this email for your records.
      </p>
    </div>
  </div>
</body>
</html>`;
}
