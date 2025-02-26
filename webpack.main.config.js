// webpack.main.config.js
module.exports = {
    entry: './electron.js', // Path to your main Electron file
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader'
          }
        }
      ]
    },
    resolve: {
      extensions: ['.js', '.json']
    }
  };