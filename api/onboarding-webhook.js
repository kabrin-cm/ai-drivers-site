// Google Sheets OAuth2 refresh token helper (matches tally-webhook.js pattern)

async function getGoogleAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token refresh failed: ${err}`);
  }

  const { access_token } = await res.json();
  return access_token;
}

async function appendToSheet(rowValues) {
  const token = await getGoogleAccessToken();
  if (!token) {
    console.warn('Google Sheets not configured, skipping');
    return null;
  }

  const SHEET_ID = '1Tfdtvb-5355NwOVmvd8ltvixlNK1XQSeJeAmVnzZivM';
  const RANGE = 'Onboarding!A:O';

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [rowValues] }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets append failed: ${err}`);
  }

  return res.json();
}

// Main webhook handler

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const DISCORD_WEBHOOK_URL = process.env.DISCORD_ONBOARDING_WEBHOOK_URL;
  if (!DISCORD_WEBHOOK_URL) {
    return res.status(500).json({ error: 'Onboarding Discord webhook not configured' });
  }

  try {
    const data = req.body;
    const fields = {};

    // Parse Tally submission fields
    if (data.data && data.data.fields) {
      for (const field of data.data.fields) {
        const label = field.label || field.key || 'Unknown';
        let value = '';

        if (field.value !== undefined && field.value !== null) {
          if (Array.isArray(field.value)) {
            value = field.value.join(', ');
          } else if (typeof field.value === 'object') {
            value = JSON.stringify(field.value);
          } else {
            value = String(field.value);
          }
        }

        if (field.options && field.options.length > 0) {
          value = field.options.map(o => o.text || o.name || o).join(', ');
        }

        if (value) {
          fields[label] = value;
        }
      }
    }

    // Extract fields (match these to your Tally form field labels)
    const name = fields['Your name'] || fields['Name'] || 'Unknown';
    const email = fields['Email address'] || fields['Email'] || '';
    const businessName = fields['Business name and website'] || fields["What's your business name and website?"] || '';
    const industry = fields['What industry are you in?'] || fields['Industry'] || '';
    const sells = fields['What do you sell?'] || '';
    const revenue = fields['Monthly revenue range'] || fields["What's your current monthly revenue range?"] || '';
    const teamSize = fields['Team size'] || fields['How many people work in your business?'] || '';
    const timeSinks = fields['List 3-5 tasks that take you the most time every week'] || '';
    const tools = fields['What tools or platforms do you currently use?'] || fields['What tools do you currently use?'] || '';
    const aiExperience = fields['AI experience level'] || fields['What have you already tried with AI?'] || '';
    const goals = fields['Top 3 business goals for the next 90 days'] || fields['What are your top 3 business goals for the next 90 days?'] || '';
    const automate = fields['If you could automate ONE thing tomorrow, what would it be?'] || fields['Automate one thing'] || '';
    const whyJoined = fields['What made you join AI Drivers?'] || fields['What made you decide to join AI Drivers?'] || '';

    // Revenue-based color coding for priority triage
    let color = 0x7b3cf5; // default purple
    if (revenue.includes('100K')) color = 0xffd700;        // gold - high revenue
    else if (revenue.includes('50K')) color = 0x00d9a4;    // teal - strong
    else if (revenue.includes('25K')) color = 0x5aecc5;    // light teal
    else if (revenue.includes('10K')) color = 0xc4a1ff;    // light purple

    const embed = {
      title: 'New Onboarding Submission',
      color: color,
      fields: [
        { name: 'Member', value: `**${name}**\n${email}`, inline: false },
        { name: 'Business', value: `${businessName}\n${industry}`, inline: true },
        { name: 'Revenue', value: revenue || 'Not specified', inline: true },
        { name: 'Team Size', value: teamSize || 'Not specified', inline: true },
        { name: 'What They Sell', value: sells || 'Not specified', inline: false },
        { name: 'Biggest Time Sinks', value: timeSinks || 'Not provided', inline: false },
        { name: 'Current Tools', value: tools || 'Not specified', inline: false },
        { name: 'AI Experience', value: aiExperience || 'Not specified', inline: true },
        { name: 'Top 3 Goals (90 Days)', value: goals || 'Not provided', inline: false },
        { name: '#1 Thing to Automate', value: automate || 'Not provided', inline: false },
        { name: 'Why They Joined', value: whyJoined || 'Not provided', inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'AI Drivers | Onboarding Questionnaire' }
    };

    const discordPayload = {
      content: `@here **${name}** just completed their onboarding questionnaire.`,
      embeds: [embed]
    };

    // Send to Discord
    const discordRes = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload)
    });

    if (!discordRes.ok) {
      const errText = await discordRes.text();
      console.error('Discord error:', errText);
      return res.status(502).json({ error: 'Discord delivery failed' });
    }

    // Append to Google Sheet (Onboarding tab)
    try {
      await appendToSheet([
        new Date().toISOString(), // Submitted
        name,                     // Name
        email,                    // Email
        businessName,             // Business
        industry,                 // Industry
        sells,                    // What They Sell
        revenue,                  // Revenue Range
        teamSize,                 // Team Size
        timeSinks,                // Time Sinks
        tools,                    // Current Tools
        aiExperience,             // AI Experience
        goals,                    // 90-Day Goals
        automate,                 // #1 Automate
        whyJoined,                // Why Joined
        'Pending Call',           // Status
      ]);
    } catch (sheetErr) {
      console.error('Google Sheets error (non-blocking):', sheetErr.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Onboarding webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
