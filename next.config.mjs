/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // situs statis: hasil build ada di folder out/
  trailingSlash: true, // /admin/pantau/ -> out/admin/pantau/index.html
  images: { unoptimized: true },
  webpack: (config) => {
    config.resolve.alias.canvas = false; // pdfjs-dist mencoba memuat 'canvas' (hanya untuk Node)
    return config;
  },
};

export default nextConfig;
