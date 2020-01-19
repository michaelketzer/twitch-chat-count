import dotenv from 'dotenv';
dotenv.config();
import api from 'twitch-api-v5';
import * as Sentry from '@sentry/node';
import fetch from 'node-fetch';
import WebSocket from 'ws';

const {WS_SERVICE='',CLIENT_ID='',CHATTERS_URL='',WEBSERVICE_URL='',CHANNEL_ID='', SENTRY_DSN=null} = process.env;

if(SENTRY_DSN) {
    Sentry.init({ dsn: SENTRY_DSN });
}

let ws: WebSocket | null = null;

var connect = function(){
    ws = new WebSocket(WS_SERVICE);
    ws.on('open', function() {
	    console.log('Backend connection established');
    });
    ws.on('error', function() {
        console.log('Backend connection error. Reconnecting...');
    });
    ws.on('close', function() {
        console.error('Backend connection closed. Trying reconnecting...');
        setTimeout(connect, 2500);
    });
};

connect();

api.clientID = CLIENT_ID;
const chattersUrl = CHATTERS_URL;
const webserviceUrl = WEBSERVICE_URL;
const previousChatter = new Set();

interface Chatters {
    chatters: {
        vips: string[];
        moderators: string[];
        staff: string[];
        admins: string[];
        global_mods: string[];
        viewers: string[];
    }
}

interface Stream {
    viewers: number;
}

function recordStats(chatter: Chatters, stream: Stream): void {
    const {vips, moderators, staff, admins, global_mods, viewers} = chatter.chatters;
    const allCurrentChatters = [...vips, ...moderators, ...staff, ...admins, ...global_mods, ...viewers];
    const joined: string[] = [], stayed: string[] = [];
    const possiblyParted = new Set([...previousChatter]);

    allCurrentChatters.forEach((user) => {
        if (previousChatter.has(user)) {
            stayed.push(user);
            possiblyParted.delete(user);
        } else {
            joined.push(user);
            previousChatter.add(user);
        }
    });
    const parted = [...possiblyParted];
    parted.forEach((name) => previousChatter.delete(name));


    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
            viewer: {chatter: {joined, stayed, parted}, totalCount: stream.viewers},
            type: 'viewers'
        }));
    }

    fetch(webserviceUrl, {method: 'POST', body: JSON.stringify({chatter: {joined, stayed, parted}, stream})})
        .then(response => {
            if (response.status === 201) {
                console.log('Saved chatters and analytics');
            } else {
                console.error('Saving failed with code', response.status)
            }
        });
}

function fetchChatter(): Promise<Chatters> {
    return new Promise((resolve => {
        fetch(chattersUrl).then(body => body.json()).then(json => resolve(json))
    }));
}

function fetchStreamData(): void {
    api.streams.channel({channelID: CHANNEL_ID}, (err: string, res) => {
        if (err) {
            console.log(err);
        } else {
            try {
                const stream = res.stream;
                if (stream) {
                    console.log(`ShokzTV is online with ${stream.viewers} viewers`);
                    fetchChatter().then((chatter) => recordStats(chatter, stream));
                } else {
                    console.log(`ShokzTV is offline`);
                }
            } catch (error) {
                console.log(error);
            }
        }
    });

    setTimeout(fetchStreamData, 90000);
}

fetchStreamData();

