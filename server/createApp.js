const fs = require('fs')
const path = require('path')
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')

const { fetchStats } = require('./cloudflare')

const checkBlacklist = require('./middleware/checkBlacklist')
const packageURL = require('./middleware/packageURL')
const fetchFile = require('./middleware/fetchFile')
const serveFile = require('./middleware/serveFile')

/**
 * A list of packages we refuse to serve.
 */
const PackageBlacklist = require('./PackageBlacklist').blacklist

morgan.token('fwd', function (req) {
  return req.get('x-forwarded-for').replace(/\s/g, '')
})

function sendHomePage(publicDir) {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')

  return function (req, res, next) {
    fetchStats(function (error, stats) {
      if (error) {
        next(error)
      } else {
        res.set({
          'Cache-Control': 'public, max-age=60',
          'Cache-Tag': 'home'
        })

        res.send(
          // Replace the __SERVER_DATA__ token that was added to the
          // HTML file in the build process (see scripts/build.js).
          html.replace('__SERVER_DATA__', JSON.stringify({
            cloudflareStats: stats
          }))
        )
      }
    })
  }
}

function errorHandler(err, req, res, next) {
  console.error(err.stack)
  res.status(500).type('text').send('Internal Server Error')
  next(err)
}

function createApp() {
  const app = express()

  app.disable('x-powered-by')

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production'
      // Modified version of the Heroku router's log format
      // https://devcenter.heroku.com/articles/http-routing#heroku-router-log-format
      ? 'method=:method path=":url" host=:req[host] request_id=:req[x-request-id] cf_ray=:req[cf-ray] fwd=:fwd status=:status bytes=:res[content-length]'
      : 'dev'
    ))
  }

  app.use(errorHandler)
  app.use(cors())

  app.get('/', sendHomePage('build'))

  app.use(express.static('build', {
    maxAge: '365d'
  }))

  app.use('/',
    packageURL,
    checkBlacklist(PackageBlacklist),
    fetchFile,
    serveFile
  )

  return app
}

module.exports = createApp
