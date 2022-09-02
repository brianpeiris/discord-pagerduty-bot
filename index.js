const fetch = require('node-fetch');
const Discord = require('discord.js');
const pd = require('node-pagerduty');

const COMMAND = '!pd';
const PAGERDUTY_ENDPOINT = 'https://events.pagerduty.com/v2/enqueue';
const {
  PAGERDUTY_SERVICE,
  PAGERDUTY_SCHEDULE,
  PAGERDUTY_ACCESS_TOKEN,
  PAGERDUTY_INTEGRATION_KEY,
  DISCORD_TOKEN
} = process.env;
const DISCORD_CHANNELS = (process.env.DISCORD_CHANNELS || '').split(',').map(c => c.trim());

const discordClient = new Discord.Client();
const pagerDutyClient = new pd(PAGERDUTY_ACCESS_TOKEN)

discordClient.once('ready', () => {
	console.log('Ready!');
});

function sendHelp(channel) {
  channel.send(`
To check current on call and incident status:
${COMMAND} status
To trigger an alert and start the escalation process:
${COMMAND} trigger <message>
  `.trim());
}

async function triggerPagerDuty(text) {
  const body = {
    routing_key: PAGERDUTY_INTEGRATION_KEY,
    event_action: "trigger",
    payload: {
      severity: "critical",
      summary: text,
      source: "discord"
    }
  }
  
  return fetch(
    PAGERDUTY_ENDPOINT,
    { 
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body) 
    }
  );
}

async function getOnCallUsers() {
  const onCallResp = await pagerDutyClient.onCalls.listAllOnCalls({schedule_ids: [PAGERDUTY_SCHEDULE]});
  const onCalls = JSON.parse(onCallResp.body).oncalls;
  return onCalls.map(oc => oc.user.summary);
}

async function getServiceStatus() {
  const incidentsResponse = await pagerDutyClient.incidents.listIncidents({
    service_ids: [PAGERDUTY_SERVICE],
    statuses: ['acknowledged', 'triggered']
  });

  const incidents = JSON.parse(incidentsResponse.body).incidents;
  const unresolvedIncidents = incidents.length === 0 ? '- No unresolved incidents -' : incidents.map(inc => `
#${inc.incident_number} (${inc.status}) ${inc.title}
${inc.html_url}
  `.trim()).join('\n\n');

  const onCallUsers = await getOnCallUsers();

  const result = `
On call now: 
${onCallUsers.join('\n')}

Unresolved incidents:
${unresolvedIncidents}
  `.trim();

  return result;
}

discordClient.on('message', async message => {
  if (!DISCORD_CHANNELS.includes(message.channel.id)) return;
  if (message.author.id === discordClient.user.id) return;

  const atMe = message.mentions.has(discordClient.user.id);
  if (atMe) { 
    sendHelp(message.channel);
    return;
  }

  if (!message.content.startsWith(COMMAND)) return;

  const content = message.content.replace(`${COMMAND}`, '').trim();
  
  const [action, ...rest] = content.split(/\s+/);

  switch(action) {
    case 'status':
      try {
        message.channel.send(await getServiceStatus());
      } catch(e) {
        message.channel.send('Failed to get pagerduty status! ' + e.message);
      }
      break;
    case 'trigger':
      const text = rest.join(' ').trim('');
      if (text === '') {
        message.channel.send('A trigger must include a message. No action performed.');
      } else {
        try {
          await triggerPagerDuty(text);
          message.channel.send('Alert triggered successfully!');
          message.channel.send(`On call now: ${(await getOnCallUsers()).join(", ")}`);
          message.channel.send('Check status with !pd status');
        } catch (e) {
          message.channel.send('Trigger failed! ' + e.message);
        }
      }
      break;
    default:
      sendHelp(message.channel);
      break;
  }
});

discordClient.login(DISCORD_TOKEN);
