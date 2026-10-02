Pod::Spec.new do |s|
  s.name           = 'BundleServer'
  s.version        = '1.0.0'
  s.summary        = 'Serves the bundled Backgammon PWA to the app WebView over loopback HTTP'
  s.description    = 'A minimal static HTTP server bound to the loopback interface that serves web/www from the app bundle.'
  s.author         = ''
  s.homepage       = 'https://bg.skeptrune.com'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.swift_version  = '5.9'
  s.source_files = 'ios/**/*.swift'
  # The PWA production build (scripts/build-web.sh puts it here). A directory
  # path (not a glob) is copied as a folder, so the bundle keeps its tree:
  # <bundle>/www/index.html, www/assets/..., www/engine/...
  s.resources = ['web/www']
end
