//@ts-check

'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const { extension } = require('showdown');
const { DefinePlugin } = require('webpack');

const extensionConfig = {
  target: 'node', // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

  entry: './src/extension/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: './node_modules/jquery/dist/jquery.min.js', to: 'resources' },
        { from: './node_modules/jquery.json-viewer/json-viewer', to: 'resources' },
        { from: './node_modules/bootstrap/dist/js/bootstrap.min.js', to: 'resources' },
        { from: './node_modules/bootstrap/dist/css/bootstrap.min.css', to: 'resources' },
        { from: './node_modules/datatables.net-bs4/js/dataTables.bootstrap4.min.js', to: 'resources' },
        { from: './node_modules/datatables.net-bs4/css/dataTables.bootstrap4.min.css', to: 'resources' },
        { from: './node_modules/datatables.net/js/jquery.dataTables.min.js', to: 'resources' },
        { from: './node_modules/datatables.net-fixedheader/js/dataTables.fixedHeader.min.js', to: 'resources' },
        { from: './node_modules/datatables.net-fixedheader-jqui/js/fixedHeader.jqueryui.min.js', to: 'resources' },
        { from: './node_modules/datatables.net-fixedheader-jqui/css/fixedHeader.jqueryui.min.css', to: 'resources' },
        { from: './node_modules/fotorama/fotorama.js', to: 'resources' },
        { from: './node_modules/fotorama/fotorama.css', to: 'resources' },
        { from: './node_modules/fotorama/fotorama.png', to: 'resources' },
        { from: './node_modules/fotorama/fotorama@2x.png', to: 'resources' },
      ]
    }),
  ],
};

const clientConfig = {
  target: 'web',
  entry: {
    "tableRenderer": "./src/client/renderers/tableRenderer.tsx"
  },
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist/'),
    filename: '[name].js',
    devtoolModuleFilenameTemplate: '../[resource-path]',
    publicPath: ''
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
  },
  module: {
    rules: [
      // Allow importing ts(x) files:
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      },
      // Allow importing CSS modules:
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(woff(2)?|ttf|eot|svg|png|jpg)(\?v=\d+\.\d+\.\d+)?$/,
        use: ['url-loader']
      }
    ]
  },
  plugins: [
    new DefinePlugin({
      "process.env": {
        NODE_ENV: JSON.stringify("production")
      }
    })
  ]
}

// module.exports = [extensionConfig, clientConfig]
module.exports = [clientConfig]
