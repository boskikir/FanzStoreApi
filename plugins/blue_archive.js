const path = require("path");

module.exports = {
  name: "random_blue_archive",
  category: "RANDOM",
  path: "/random/blue_archive",
  method: "get",

  handler: async (req, res) => {
    try {
      const imagesPath = path.join(process.cwd(), "src", "image.js");

      delete require.cache[require.resolve(imagesPath)];
      const images = require(imagesPath);

      const list = images.random_blue_archive; // pake key kamu
      if (!list || !Array.isArray(list)) {
        return res.status(404).send("List tidak ditemukan");
      }

      const randomImg = list[Math.floor(Math.random() * list.length)];

      return res.status(200).json({
        url: randomImg
      });

    } catch (err) {
      console.error(err);
      return res.status(500).send("internal error");
    }
  }
};