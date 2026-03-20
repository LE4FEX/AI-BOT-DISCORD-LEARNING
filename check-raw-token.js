const token = process.env.DISCORD_TOKEN;
console.log('Token starts with quote?', token.startsWith("'") || token.startsWith('"'));
console.log('Token ends with quote?', token.endsWith("'") || token.endsWith('"'));
console.log('Token length:', token.length);
console.log('Raw token:', JSON.stringify(token));
