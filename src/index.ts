import { DateTime, Settings } from 'luxon'
import { decode } from 'html-entities'
import Mustache from 'mustache'

import indexPage from './index.html'
import errorPage from './error.html'

type RawMeal = {
  title: string
  startdate: string
  enddate: string
  description: string
}

type Meal = {
  title: string
  short_time: string
  items: string[]
}

type Handler = (event: FetchEvent) => Promise<Response>
type Middleware = (handler: Handler) => Handler

Settings.defaultZone = 'America/New_York'

const menuQuery = `query menu($timeMin: String, $timeMax: String) {
  result: googlecalfeed(
    calendarId: "jclttimvq42gicrv1vkl0cpmoc@group.calendar.google.com",
    timeMin: $timeMin,
    timeMax: $timeMax,
    order: ASC
  ) {
    data {
      title
      startdate
      enddate
      description
    }
  }
}`

function parseMeal(meal: RawMeal): Meal {
  const startdate = DateTime.fromISO(meal.startdate)
  const enddate = DateTime.fromISO(meal.enddate)

  return {
    title: meal.title,
    short_time: `${startdate.toFormat('h:mm')} to ${enddate.toFormat('h:mm')}`,
    // split on <br> and newlines
    items: meal.description.split(/(?:<\s*\/?\s*br\s*\/?\s*>)|\n/).map((item) =>
      decode(item.replace(/<\/?[^>]+(>|$)/g, '')) // holy shit (remove html tags)
        .trim()
        .replace(/::(.*?)::/g, function (dietary) {
          switch (dietary) {
            case '::vegan::':
              return '(v)'
            case '::vegetarian::':
              return '(vg)'
            case '::kosher::':
              return '(k)'
            case '::halal::':
              return '(h)'
            case '::gluten-free::':
              return '(gf)'
            default:
              return ''
          }
        }),
    ),
  }
}

async function handleRequest(event: Event): Promise<Response> {
  const now = DateTime.now()

  const url = new URL('https://dash.swarthmore.edu/graphql')
  url.searchParams.set('query', menuQuery)
  url.searchParams.set('operationName', 'menu')
  url.searchParams.set(
    'variables',
    JSON.stringify({
      timeMin: now.startOf('day').toISO(),
      timeMax: now.endOf('day').toISO(),
    }),
  )

  const rsp = (await (await fetch(url.toString())).json()) as any
  const rawMenu = rsp.data.result.data as RawMeal[]
  const menu = rawMenu
    .map(parseMeal)
    .filter((m) => ['Brunch', 'Lunch', 'Dinner'].includes(m.title))

  return new Response(
    Mustache.render(indexPage, {
      date: now.toFormat('MMM d'),
      meals: menu,
    }),
    {
      headers: { 'content-type': 'text/html' },
    },
  )
}

const withCache: Middleware = (handler) => async (event) => {
  const cache = caches.default
  const cacheUrl = new URL(event.request.url)
  const cacheKey = new Request(cacheUrl.toString(), event.request)

  let response = await caches.default.match(cacheKey)
  if (!response) {
    response = await handler(event)

    if (response.status === 200) {
      response = new Response(response.body, response)
      response.headers.append('Cache-Control', 's-maxage=300')
      event.waitUntil(cache.put(cacheKey, response.clone()))
    }
  }

  return response
}

const withTry: Middleware = (handler) => async (event) => {
  try {
    return await handler(event)
  } catch (error) {
    return new Response(errorPage, {
      headers: { 'content-type': 'text/html' },
      status: 500,
    })
  }
}

addEventListener('fetch', (event) => {
  event.respondWith(withCache(withTry(handleRequest))(event))
})
