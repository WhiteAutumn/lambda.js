const p = require("phin");
const shared = require("./exampleSharedCode");

module.exports.handler = async () => {
  try {
    p("not.a.valid.url");
    shared.throwAnException();
  }
  catch (error) {
    
  }
};
