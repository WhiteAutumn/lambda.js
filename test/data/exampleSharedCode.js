const { default: Exception } = require("exceptions-with-cause");

module.exports.throwAnException = () => {
  throw new Exception("Example!");
};
