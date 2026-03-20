console.log("Token length:", process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.length : "undefined");
if (process.env.DISCORD_TOKEN) {
    console.log("First 5 chars:", process.env.DISCORD_TOKEN.substring(0, 5));
    console.log("Last 5 chars:", process.env.DISCORD_TOKEN.substring(process.env.DISCORD_TOKEN.length - 5));
    console.log("Contains spaces?", process.env.DISCORD_TOKEN.includes(" "));
}
