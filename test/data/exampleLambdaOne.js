const axios = require("axios");
const shared = require("./exampleSharedCode");

module.exports.handler = async () => {
  try {
    axios.get("not.a.valid.url");
    shared.throwAnException();
  }
  catch (error) {

  }
};
