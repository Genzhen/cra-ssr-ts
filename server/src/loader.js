// Express requirements
import path from 'path'
import fs from 'fs'

// React requirements
import React from 'react'
import ReactDOMServer from '../../node_modules/react-dom/server'
import Helmet from 'react-helmet'
import { Provider } from 'react-redux'
import { StaticRouter } from 'react-router'
import { Frontload, frontloadServerRender } from 'react-frontload'
import { IntlProvider } from 'react-intl'
import { ConfigProvider } from 'antd'
import Loadable from 'react-loadable'

// Our store, entrypoint, and manifest
import createStore from '../../src/modules/store'
import Root from '../../src/app/Root'
import manifest from '../../build/asset-manifest.json'
// 多语言
import { appIntlEn, appIntlZh } from '../../src/locales'
// Some optional Redux functions related to user authentication
import {
  setCurrentUserAction,
  logoutUser
} from '../../src/modules/actions/auth'

// 注释 暂不需要 react-intl 提供的locale-data
// addLocaleData([...appZhLocale.data, ...appEnLocale.data])

/*
    A simple helper function to prepare the HTML markup. This loads:
      - Page title
      - SEO meta tags
      - Preloaded state (for Redux) depending on the current route
      - React-intl 国际化、多语言文件 配置
      - Code-split script tags depending on the current route
      - 浏览器兼容性 ie11 及以下 polyfill
  */
const injectHTML = (
  data,
  { html, title, meta, body, scripts, state, intl }
) => {
  data = data.replace('<html>', `<html ${html}>`)
  data = data.replace(/<title>.*?<\/title>/g, title)
  data = data.replace('</head>', `${meta}</head>`)
  data = data.replace(
    '<div id="root"></div>',
    `<div id="root">${body}</div><script>window.__PRELOADED_STATE__ = ${state}</script><script>window.__INTL_CONFIG__ = ${intl}</script>${scripts.join(
      ''
    )}`
  )

  return data
}

// 缓存语言文件
const intlMap = {
  en: appIntlEn,
  zh: appIntlZh
}

// loader middlewares
export default async function (ctx, next) {
  let htmlData = ''

  try {
    // Load in our HTML file from our build
    htmlData = fs.readFileSync(
      path.resolve(process.cwd(), './build/view/index.html'),
      'utf8'
    )
  } catch (err) {
    console.error('Read error', err)

    return (ctx.status = 404)
  }

  // Create a store (with a memory history) from our current url
  const { store } = createStore(ctx.url)
  // If the user has a cookie (i.e. they're signed in) - set them as the current user
  // Otherwise, we want to set the current state to be logged out, just in case this isn't the default
  const myWebsite = ctx.cookies.get('mywebsite')

  if (myWebsite) {
    store.dispatch(setCurrentUserAction(myWebsite))
  } else {
    store.dispatch(logoutUser())
  }

  // 多语言配置
  const appLocale = intlMap[ctx.i18n.key]
  const context = {}
  const modules = []

  let routeMarkup = ''

  /*
    Here's the core funtionality of this file. We do the following in specific order (inside-out):
      1. Load the <App /> component
      2. Inside of the Frontload HOC
      3. Inside of a Redux <StaticRouter /> (since we're on the server), given a location and context to write to
      4. Inside of the store provider and IntlProvider
      5. Inside of the React Loadable HOC to make sure we have the right scripts depending on page
      6. Render all of this sexiness
      7. Make sure that when rendering Frontload knows to get all the appropriate preloaded requests

    In English, we basically need to know what page we're dealing with, and then load all the appropriate scripts and
    data for that page. We take all that information and compute the appropriate state to send to the user. This is
    then loaded into the correct components and sent as a Promise to be handled below.
  */
  try {
    routeMarkup = await frontloadServerRender(
      () =>
        ReactDOMServer.renderToString(
          <Provider store={store}>
            <IntlProvider
              locale={appLocale.locale}
              messages={appLocale.messages}
            >
              <Loadable.Capture report={m => modules.push(m)}>
                <ConfigProvider locale={appLocale.antdLocale}>
                  <StaticRouter location={ctx.url} context={context}>
                    <Frontload>
                      <Root />
                    </Frontload>
                  </StaticRouter>
                </ConfigProvider>
              </Loadable.Capture>
            </IntlProvider>
          </Provider>
        ),
      {
        // If any frontload function throws an Error, swallow it and just carry on rendering.
        // The default is false, meaning the first encountered Error will be thrown by
        // frontloadServerRender, so that it can be caught and handled (perhaps by responding with an error page).
        continueRenderingOnError: true
      }
    )
  } catch (err) {
    console.error('React renderToString error', err)

    return (ctx.status = 404)
  }

  if (context.url) {
    // If context has a url property, then we need to handle a redirection in Redux Router
    ctx.status = 302

    return ctx.redirect(context.url)
  } else {
    // Otherwise, we carry on...

    // Let's give ourself a function to load all our page-specific JS assets for code splitting
    const extractAssets = (assets, chunks) =>
      Object.keys(assets)
        .filter(asset => chunks.indexOf(asset.replace('.js', '')) > -1)
        .map(k => assets[k])

    // Let's format those assets into pretty <script> tags
    const extraChunks = extractAssets(manifest, modules).map(
      c =>
        `<script type="text/javascript" src="/${c.replace(
          /^\//,
          ''
        )}"></script>`
    )

    // We need to tell Helmet to compute the right meta tags, title, and such
    const helmet = Helmet.renderStatic()

    // 多语言数据
    const appIntl = Object.assign(
      { key: ctx.i18n.key },
      { messages: appLocale.messages, locale: appLocale.appLocale }
    )

    // NOTE: Disable if you desire
    // Let's output the title, just to see SSR is working as intended
    console.log('THE TITLE', helmet.title.toString())

    // Pass all this nonsense into our HTML formatting function above
    const html = injectHTML(htmlData, {
      html: helmet.htmlAttributes.toString(),
      title: helmet.title.toString(),
      meta: helmet.meta.toString(),
      body: routeMarkup,
      scripts: extraChunks,
      state: JSON.stringify(store.getState()).replace(/</g, '\\u003c'),
      intl: JSON.stringify(appIntl)
    })

    // We have all the final HTML, let's send it to the user already!
    ctx.response.type = 'html'
    ctx.response.body = html
  }

  next()
}
