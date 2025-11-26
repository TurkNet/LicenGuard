import path from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';
import dotenv from 'dotenv';

const ROOT_DIR = path.dirname(new URL(import.meta.url).pathname);
dotenv.config({ path: path.resolve(ROOT_DIR, '.env') });

try {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    // Override Node's experimental WebStorage getter so html-webpack-plugin won't crash
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined
      }
    });
  }
} catch {
  // ignore if redefinition fails
}

export default (env = {}) => {
  const isProduction = env.production ?? process.env.NODE_ENV === 'production';
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

  return {
    mode: isProduction ? 'production' : 'development',
    entry: path.resolve(ROOT_DIR, 'src/main.jsx'),
    output: {
      path: path.resolve(ROOT_DIR, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      chunkFilename: isProduction ? '[name].[contenthash].js' : '[name].js',
      publicPath: '/',
      clean: true
    },
    devtool: isProduction ? 'source-map' : 'eval-cheap-module-source-map',
    resolve: {
      extensions: ['.js', '.jsx']
    },
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true,
              presets: [
                ['@babel/preset-env', { targets: 'defaults' }],
                ['@babel/preset-react', { runtime: 'automatic' }]
              ]
            }
          }
        },
        {
          test: /\.(png|jpe?g|gif|svg)$/i,
          type: 'asset/resource',
          generator: {
            filename: 'assets/[name][hash][ext][query]'
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        }
      ]
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(ROOT_DIR, 'index.html'),
        inject: 'body',
        templateParameters: {}
      }),
      new webpack.DefinePlugin({
        'process.env.API_URL': JSON.stringify(apiUrl)
      })
    ],
    devServer: {
      static: {
        directory: path.resolve(ROOT_DIR, 'public')
      },
      port: 5173,
      open: false,
      hot: true,
      historyApiFallback: true,
      client: {
        logging: 'info'
      },
      onListening: (server) => {
        const addr = server.server.address();
        const host = addr && typeof addr === 'object' ? addr.address : 'localhost';
        const port = addr && typeof addr === 'object' ? addr.port : 5173;
        const url = `http://${host === '::' ? 'localhost' : host}:${port}`;
        // Printed to dev server stdout so it shows in VS Code Debug Console when capturing std
        console.log(`[LicenGuard Web] dev server running at ${url} (API: ${apiUrl})`);
      }
    }
  };
};
