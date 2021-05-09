import axios from "axios";

export async function handler() {
  console.log("Hello!");

  const result = await axios.get("https://swapi.dev/api/planets/1/");
  console.log(result);
};