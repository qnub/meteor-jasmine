/* global
 Velocity: false
 */

ClientIntegrationTestFramework = function (options) {
  options = options || {}

  _.defaults(options, {
    name: 'jasmine-client-integration',
    regex: '^tests/jasmine/client/integration/.+\\.(js|coffee|litcoffee|coffee\\.md)$',
    sampleTestGenerator: function () {
      return [
        {
          path: 'jasmine/client/integration/sample/spec/PlayerSpec.js',
          contents: Assets.getText('client/integration/sample-tests/sample/spec/PlayerSpec.js')
        },
        {
          path: 'jasmine/client/integration/sample/spec/SpecMatchers.js',
          contents: Assets.getText('client/integration/sample-tests/sample/spec/SpecMatchers.js')
        },
        {
          path: 'jasmine/client/integration/sample/src/Player.js',
          contents: Assets.getText('client/integration/sample-tests/sample/src/Player.js')
        },
        {
          path: 'jasmine/client/integration/sample/src/Song.js',
          contents: Assets.getText('client/integration/sample-tests/sample/src/Song.js')
        }
      ]
    },
    jasmineRequire: Meteor.isClient ? window.jasmineRequire : null
  })

  JasmineTestFramework.call(this, options)

  if (Meteor.isClient) {
    this._setup()
  }
}

ClientIntegrationTestFramework.prototype = Object.create(JasmineTestFramework.prototype)

_.extend(ClientIntegrationTestFramework.prototype, {

  _setup: function () {
    this.jasmine = this.jasmineRequire.core(this.jasmineRequire)
    this.jasmineInterface = new JasmineInterface({jasmine: this.jasmine})
    _.extend(window, this.jasmineInterface)
  },

  startMirror: function () {
    var mirrorOptions = {
      port: this._getCustomPort(),
      rootUrlPath: '/?jasmine=true'
    }
    var mirrorStarter = new MirrorStarter(this.name)
    mirrorStarter.lazyStartMirror(mirrorOptions)
  },

  _getCustomPort: function () {
    var customPort = parseInt(process.env.JASMINE_MIRROR_PORT, 10)
    if (!_.isNaN(customPort)) {
      return customPort
    }
  },

  runTests: function () {
    var self = this

    Meteor.call('jasmine/isMirror', function(error, mirrorInfo) {
      if (error) {
        throw error
      } else if (mirrorInfo.isMirror) {
        Meteor.setTimeout(function() {
          if (/jasmine=true/.test(document.location.href.split("?")[1])) {
            log.info('Running Jasmine tests');

            window.ddpParentConnection = DDP.connect(mirrorInfo.parentUrl)

            window.ddpParentConnection.call('velocity/reports/reset', {framework: self.name})

            /**
             * Since this is being run in a browser and the results should populate to an HTML page, require the HTML-specific Jasmine code, injecting the same reference.
             */
            self.jasmineRequire.html(self.jasmine)

            /**
             * Create the Jasmine environment. This is used to run all specs in a project.
             */
            var env = self.jasmine.getEnv()

            /**
             * ## Runner Parameters
             *
             * More browser specific code - wrap the query string in an object and to allow for getting/setting parameters from the runner user interface.
             */

            var queryString = new self.jasmine.QueryString({
              getWindowLocation: function () {
                return window.location
              }
            })

            var catchingExceptions = queryString.getParam('catch')
            env.catchExceptions(typeof catchingExceptions === 'undefined' ? true : catchingExceptions)

            /**
             * ## Reporters
             */
            var velocityReporter = new VelocityTestReporter({
              mode: "Client Integration",
              framework: self.name,
              env: env,
              timer: new self.jasmine.Timer(),
              ddpParentConnection: window.ddpParentConnection
            })

            var currentId;

            var serverReporter = {
              jasmineStarted: function () {
                window.ddpParentConnection.call("jasmine/startedConsumer",
                  function (err, result) {
                    currentId = result;
                  });
              },
              jasmineDone: function () {
                if (currentId){
                  window.ddpParentConnection.call("jasmine/doneConsumer", currentId);
                }
              },
              specDone: function (result) {
                if (currentId){
                  window.ddpParentConnection.call("jasmine/specDoneConsumer",
                    result,
                    currentId);
                }
              }
            }

            env.addReporter(serverReporter);

            /**
             * The `jsApiReporter` also receives spec results, and is used by any environment that needs to extract the results  from JavaScript.
             */
            env.addReporter(self.jasmineInterface.jsApiReporter)
            env.addReporter(velocityReporter)

            /**
             * Filter which specs will be run by matching the start of the full name against the `spec` query param.
             */
            var specFilter = new self.jasmine.HtmlSpecFilter({
              filterString: function () {
                return queryString.getParam('spec')
              }
            })

            env.specFilter = function (spec) {
              return specFilter.matches(spec.getFullName())
            }

            /**
             * Setting up timing functions to be able to be overridden. Certain browsers (Safari, IE 8, phantomjs) require this hack.
             */
            window.setTimeout = window.setTimeout
            window.setInterval = window.setInterval
            window.clearTimeout = window.clearTimeout
            window.clearInterval = window.clearInterval

            env.execute()
          }
        }, 0)
      } else {
        var iframeId = 'jasmine-mirror';

        var insertMirrorIframe = _.once(function (mirrorInfo) {
          var iframe = document.createElement('iframe')
          iframe.id = iframeId
          iframe.src = mirrorInfo.rootUrl
          // Make the iFrame invisible
          iframe.style.width = 0
          iframe.style.height = 0
          iframe.style.border = 0
          document.body.appendChild(iframe)
        })

        var updateMirrorIframe = function (mirrorInfo) {
          var iframe = document.getElementById(iframeId)
          if (iframe) {
            iframe.src = mirrorInfo.rootUrl
          } else {
            insertMirrorIframe(mirrorInfo)
          }
        }

        Tracker.autorun(function () {
          var mirror = VelocityMirrors.findOne(
            {framework: self.name, state: 'ready'},
            {fields: {state: 1, rootUrl: 1}}
          )
          if (mirror) {
            updateMirrorIframe(mirror)
          }
        })
      }
    })
  },

  _reportResults: function () {
    Meteor.call('velocity/reports/completed', {framework: this.name})
  }
})
