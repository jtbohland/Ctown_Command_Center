import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// All 119 rookies from 2025 dynasty rookie rankings CSV
const ROOKIES = [
  "Jeremiyah Love", "Carnell Tate", "Jordyn Tyson", "Makai Lemon",
  "KC Concepcion", "Jadarian Price", "Kenyon Sadiq", "Omar Cooper Jr.",
  "Fernando Mendoza", "Eli Stowers", "Denzel Boston", "Jonah Coleman",
  "Antonio Williams", "Chris Bell", "Nicholas Singleton", "Germie Bernard",
  "Emmett Johnson", "De'Zhaun Stribling", "Elijah Sarratt", "Ted Hurst III",
  "Kaytron Allen", "Chris Brazzell II", "Ty Simpson", "Malachi Fields",
  "Zachariah Branch", "Oscar Delp", "Demond Claiborne", "Mike Washington Jr.",
  "Eli Raridon", "Kaelon Black", "Skyler Bell", "Ja'Kobi Lane",
  "Max Klare", "Adam Randall", "Carson Beck", "Bryce Lance",
  "Eli Heidenreich", "Kevin Coleman Jr.", "Seth McGowan", "Justin Joly",
  "Brenen Thompson", "Drew Allar", "Cole Payton", "Cade Klubnik",
  "Jam Miller", "Marlin Klein", "Caleb Douglas", "J'Mari Taylor",
  "Sam Roush", "Taylen Green", "Tanner Koziol", "Cyrus Allen",
  "Zavion Thomas", "Jaydn Ott", "Garrett Nussmeier", "Roman Hemby",
  "Deion Burks", "Robert Henry Jr.", "CJ Daniels", "Reggie Virgil",
  "Barion Brown", "Malik Benson", "Nate Boerkircher", "Dean Connors",
  "Jack Endries", "Noah Whittington", "Josh Cameron", "Colbie Young",
  "Matt Hibner", "Jeff Caldwell", "Kendrick Law", "Terion Stewart",
  "Desmond Reid", "Michael Trigg", "Eric Rivers Jr.", "CJ Donaldson",
  "Chip Trayanum", "Joe Royer", "Lewis Bond", "Jamal Haynes",
  "Tyren Montgomery", "Eric McAlister", "Aaron Anderson", "Kaden Wetjen",
  "John Michael Gyllenborg", "Josh Cuevas", "Rahsul Faison", "Diego Pavia",
  "Brendan Sorsby", "Dane Key", "J. Michael Sturdivant", "Riley Nowakowski",
  "Trebor Pena", "Dae'Quan Wright", "TJ Harden", "Haynes King",
  "Max Bredeson", "Harrison Wallace III", "Will Kacmarek", "Dallen Bentley",
  "Joey Aguilar", "Noah Thomas", "Chase Roberts", "Luke Altmyer",
  "Jalon Daniels", "Joe Fagnano", "Emmanuel Henderson Jr.", "Seydou Traore",
  "Kentrel Bullock", "Sawyer Robertson", "Miller Moss", "Jaren Kanak",
  "Jack Velling", "Rueben Owens II", "Athan Kaliakmanis", "Caullin Lacy",
  "Behren Morton", "Vinny Anthony II", "Al-Jay Henderson",
];

export default api({
  name: "BulkTagRookies",
  description: "Tags all rookies from the 2025 dynasty CSV with the rookie tag.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    tagged: z.number(),
  }),

  async run(ctx) {
    const placeholders = ROOKIES.map((_, i) => `$${i + 1}`).join(", ");

    const result = await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_player_tags (player_id, tag)
       SELECT id, 'rookie' FROM ffwr_players
       WHERE name IN (${placeholders})
       ON CONFLICT (player_id, tag) DO NOTHING`,
      ROOKIES,
      { label: "Bulk-tag rookies from dynasty CSV" }
    );

    return { tagged: result.rowCount ?? 0 };
  },
});
