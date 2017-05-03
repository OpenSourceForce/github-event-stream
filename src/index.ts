require('dotenv').load({ silent: true });

import fetch from 'node-fetch';
import { Subject } from '@reactivex/rxjs';

const log = console.log.bind(console);
const error = console.error.bind(console);

const {
  GITHUB_TOKEN,
} = process.env;

let EVENTS_ENDPOINT = 'https://api.github.com/events';
let DEFAULT_INTERVAL = 60;

let cache = {};
let subject = new Subject();

function deiriify(iri) {
  return iri.match(/<(.*)>/)[1];
}

function parseLinks(links) {
  return links
    .split(',')
    .map(x => x.split(';'))
    .reduce((memo, x) => {
      let [ iri, rel ] = x;

      let link = deiriify(iri);
      let label = JSON.parse(rel.split('=')[1]);

      memo[label] = link;

      return memo;
    }, {});
}

function dedup(events) {
  return Object.values(events.reduce((memo, event) => {
    memo[event.id] = event;
    return memo;
  }, {}));
}

async function fetchEvents(links) {
  let headers;
  let result = [];

  while('next' in links && !result.some(({ id }) => id in cache)) {
    let { next } = links;
    console.log(`Fetching ${next}`);
    let response = await fetch(next, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`
      }
    });
    let { headers: h, data } = await processResponse(response);

    headers = h;
    links = parseLinks(headers.get('link'));
    result = result.concat(data);
  }

  console.log(`Returning ${result.length} events`);

  return { headers, data: dedup(result) };
}

async function processResponse(response) {
  console.log('Processing response...');

  let headers = response.headers;
  let data = await response.json();

  if (response.status === 403) {
    let rateLimit = headers.get('x-ratelimit-limit')
    let rateLimitRemaining = headers.get('x-ratelimit-remaining')
    throw new Error(`Status code 403: Forbidden. Ratelimit: ${rateLimitRemaining} out of ${rateLimit}`);
  }

  return { headers, data };
}

async function processEvents(events) {
  console.log(`Processing ${events.length} events...`);

  events.forEach(event => {
    let { id } = event;
    if (id in cache) {
      console.log(`Disregarding event ${id} because it is already in the cache`);
      return;
    }

    // console.log('Event:', event);
    subject.next(event);
  });

  cache = events.reduce((memo, event) => {
    memo[event.id] = true;
    return memo;
  }, {});

  // console.log('Cache size:', Object.keys(cache).length);
}

async function poll() {
  console.log(`Polling...`)
  let { headers, data: events } = await fetchEvents({ next: EVENTS_ENDPOINT });

  let rateLimit = headers.get('x-ratelimit-limit')
  let rateLimitRemaining = headers.get('x-ratelimit-remaining')
  // let interval = parseInt(headers.get('x-poll-interval'));
  let interval = 15;

  await processEvents(events);

  console.log(`Setting timeout before polling again: ${interval} seconds`);
  console.log(`Current ratelimit status: ${rateLimitRemaining} out of ${rateLimit}`);
  setTimeout(poll, interval * 1000);
}

// subject.subscribe(log);
poll().catch(error);
