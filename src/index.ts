import { format } from 'date-fns'
import { utcToZonedTime } from 'date-fns-tz'
import { decode } from 'html-entities'
import Mustache from 'mustache'

import indexPage from './index.html'
import errorPage from './error.html'

type RawMeal = {
  title: string
  startdate: string
  enddate: string
  short_time: string
  description: string
  html_description: string
}

type Meal = {
  title: string
  short_time: string
  items: string[]
}

type Handler = (event: FetchEvent) => Promise<Response>
type Middleware = (handler: Handler) => Handler

function parseMeal(meal: RawMeal): Meal {
  return {
    title: meal.title,
    short_time: meal.short_time,
    items: decode(meal.description)
      .split(';')
      .map((item) =>
        item.trim().replace(/::(.*?)::/g, function (dietary) {
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
  const resp = await fetch('https://dash.swarthmore.edu/dining_json')
  const rawMenu = ((await resp.json()) as any).sharples as RawMeal[]
  const menu = rawMenu
    .map(parseMeal)
    .filter((m) => ['Lunch', 'Dinner'].includes(m.title))

  const now = utcToZonedTime(new Date(), 'America/New_York')

  return new Response(
    Mustache.render(indexPage, {
      date: format(now, 'MMM d'),
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
