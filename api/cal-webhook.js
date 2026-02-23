export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const DISCORD_WEBHOOK_URL = process.env.DISCORD_CAL_WEBHOOK_URL;
  if (!DISCORD_WEBHOOK_URL) {
    return res.status(500).json({ error: 'Cal booking Discord webhook not configured' });
  }

  try {
    const data = req.body;

    // Cal.com sends different payload structures based on the trigger
    // We handle BOOKING_CREATED
    const payload = data.payload || data;
    const triggerEvent = data.triggerEvent || '';

    if (triggerEvent && triggerEvent !== 'BOOKING_CREATED') {
      return res.status(200).json({ ok: true, skipped: triggerEvent });
    }

    // Extract booking details from Cal.com payload
    const title = payload.title || 'AI Drivers Onboarding Call';
    const startTime = payload.startTime || '';
    const endTime = payload.endTime || '';
    const attendeeName = (payload.attendees && payload.attendees[0] && payload.attendees[0].name) || 'Unknown';
    const attendeeEmail = (payload.attendees && payload.attendees[0] && payload.attendees[0].email) || '';
    const meetingUrl = payload.metadata && payload.metadata.videoCallUrl
      ? payload.metadata.videoCallUrl
      : payload.meetingUrl || '';

    // Format the date/time nicely
    let dateDisplay = 'Not available';
    let timeDisplay = '';
    if (startTime) {
      const start = new Date(startTime);
      const end = endTime ? new Date(endTime) : null;
      const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
      const timeOpts = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
      dateDisplay = start.toLocaleDateString('en-US', options);
      timeDisplay = start.toLocaleTimeString('en-US', timeOpts);
      if (end) {
        timeDisplay += ` - ${end.toLocaleTimeString('en-US', timeOpts)}`;
      }
    }

    const embed = {
      title: 'Assessment Call Booked',
      color: 0x00d9a4, // teal - booked
      fields: [
        { name: 'Member', value: `**${attendeeName}**\n${attendeeEmail}`, inline: false },
        { name: 'Date', value: dateDisplay, inline: true },
        { name: 'Time', value: timeDisplay || 'See calendar', inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'AI Drivers | Cal.com Booking' }
    };

    if (meetingUrl) {
      embed.fields.push({ name: 'Meeting Link', value: meetingUrl, inline: false });
    }

    const discordPayload = {
      content: `@here **${attendeeName}** just booked their onboarding call for **${dateDisplay}**.`,
      embeds: [embed]
    };

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

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Cal webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
