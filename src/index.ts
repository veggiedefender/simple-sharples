import { format } from 'date-fns'
import { utcToZonedTime } from 'date-fns-tz'
import { decode } from 'html-entities'
import Mustache from 'mustache'

import indexPage from './index.html'

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

export async function handleRequest(request: Request): Promise<Response> {
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

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request))
})
