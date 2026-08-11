import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// Format: [name, position, rank]
type AdpEntry = [string, string, number];

// 2019-20 ADP — Top 120 (Saquon Barkley #1)
const ADP_2019: AdpEntry[] = [
  ["Saquon Barkley", "RB", 1], ["Christian McCaffrey", "RB", 2], ["Alvin Kamara", "RB", 3],
  ["Ezekiel Elliott", "RB", 4], ["DeAndre Hopkins", "WR", 5], ["David Johnson", "RB", 6],
  ["Le'Veon Bell", "RB", 7], ["Davante Adams", "WR", 8], ["James Conner", "RB", 9],
  ["Julio Jones", "WR", 10], ["Michael Thomas", "WR", 11], ["Odell Beckham Jr.", "WR", 12],
  ["Todd Gurley II", "RB", 13], ["JuJu Smith-Schuster", "WR", 14], ["Travis Kelce", "TE", 15],
  ["Tyreek Hill", "WR", 16], ["Nick Chubb", "RB", 17], ["Dalvin Cook", "RB", 18],
  ["Joe Mixon", "RB", 19], ["Patrick Mahomes", "QB", 20], ["Antonio Brown", "WR", 21],
  ["Mike Evans", "WR", 22], ["Adam Thielen", "WR", 23], ["Keenan Allen", "WR", 24],
  ["Leonard Fournette", "RB", 25], ["George Kittle", "TE", 26], ["Zach Ertz", "TE", 27],
  ["Kerryon Johnson", "RB", 28], ["Devonta Freeman", "RB", 29], ["Amari Cooper", "WR", 30],
  ["Stefon Diggs", "WR", 31], ["Aaron Jones", "RB", 32], ["Josh Jacobs", "RB", 33],
  ["Damien Williams", "RB", 34], ["Julian Edelman", "WR", 35], ["Chris Carson", "RB", 36],
  ["Derrick Henry", "RB", 37], ["Brandin Cooks", "WR", 38], ["T.Y. Hilton", "WR", 39],
  ["Robert Woods", "WR", 40], ["Marlon Mack", "RB", 41], ["Melvin Gordon", "RB", 42],
  ["Deshaun Watson", "QB", 43], ["Kenny Golladay", "WR", 44], ["Mark Ingram", "RB", 45],
  ["David Montgomery", "RB", 46], ["Chris Godwin", "WR", 47], ["Tyler Lockett", "WR", 48],
  ["Sony Michel", "RB", 49], ["Cooper Kupp", "WR", 50], ["Aaron Rodgers", "QB", 51],
  ["James White", "RB", 52], ["Phillip Lindsay", "RB", 53], ["Tyler Boyd", "WR", 54],
  ["Evan Engram", "TE", 55], ["O.J. Howard", "TE", 56], ["Calvin Ridley", "WR", 57],
  ["Baker Mayfield", "QB", 58], ["Mike Williams", "WR", 59], ["A.J. Green", "WR", 60],
  ["Hunter Henry", "TE", 61], ["DJ Moore", "WR", 62], ["Jarvis Landry", "WR", 63],
  ["Matt Ryan", "QB", 64], ["Alshon Jeffery", "WR", 65], ["Tarik Cohen", "RB", 66],
  ["Tevin Coleman", "RB", 67], ["Austin Ekeler", "RB", 68], ["Jared Cook", "TE", 69],
  ["Allen Robinson", "WR", 70], ["Miles Sanders", "RB", 71], ["Josh Gordon", "WR", 72],
  ["Kenyan Drake", "RB", 73], ["Duke Johnson", "RB", 74], ["Robby Anderson", "WR", 75],
  ["Drew Brees", "QB", 76], ["Derrius Guice", "RB", 77], ["Carson Wentz", "QB", 78],
  ["Chicago Bears", "DST", 79], ["Vance McDonald", "TE", 80], ["Sammy Watkins", "WR", 81],
  ["Russell Wilson", "QB", 82], ["Dede Westbrook", "WR", 83], ["Cam Newton", "QB", 84],
  ["Will Fuller", "WR", 85], ["Sterling Shepard", "WR", 86], ["Jared Goff", "QB", 87],
  ["Christian Kirk", "WR", 88], ["David Njoku", "TE", 89], ["Latavius Murray", "RB", 90],
  ["Corey Davis", "WR", 91], ["Marvin Jones", "WR", 92], ["Emmanuel Sanders", "WR", 93],
  ["Curtis Samuel", "WR", 94], ["Jordan Howard", "RB", 95], ["LeSean McCoy", "RB", 96],
  ["Larry Fitzgerald", "WR", 97], ["Eric Ebron", "TE", 98], ["Rashaad Penny", "RB", 99],
  ["Ben Roethlisberger", "QB", 100], ["Darrell Henderson", "RB", 101], ["Los Angeles Rams", "DST", 102],
  ["Dante Pettis", "WR", 103], ["Matt Breida", "RB", 104], ["Devin Singletary", "RB", 105],
  ["Royce Freeman", "RB", 106], ["Courtland Sutton", "WR", 107], ["Austin Hooper", "TE", 108],
  ["Greg Zuerlein", "K", 109], ["Kyler Murray", "QB", 110], ["Marquez Valdes-Scantling", "WR", 111],
  ["Tom Brady", "QB", 112], ["Kareem Hunt", "RB", 113], ["Lamar Jackson", "QB", 114],
  ["Jacksonville Jaguars", "DST", 115], ["Delanie Walker", "TE", 116], ["Geronimo Allison", "WR", 117],
  ["Justin Tucker", "K", 118], ["Peyton Barber", "RB", 119], ["James Washington", "WR", 120],
];

// 2020-21 ADP — Top 120 (CMC #1)
const ADP_2020: AdpEntry[] = [
  ["Christian McCaffrey", "RB", 1], ["Saquon Barkley", "RB", 2], ["Ezekiel Elliott", "RB", 3],
  ["Dalvin Cook", "RB", 4], ["Michael Thomas", "WR", 5], ["Alvin Kamara", "RB", 6],
  ["Derrick Henry", "RB", 7], ["Davante Adams", "WR", 8], ["Josh Jacobs", "RB", 9],
  ["Joe Mixon", "RB", 10], ["Clyde Edwards-Helaire", "RB", 11], ["Miles Sanders", "RB", 12],
  ["Austin Ekeler", "RB", 13], ["Tyreek Hill", "WR", 14], ["Nick Chubb", "RB", 15],
  ["Kenyan Drake", "RB", 16], ["Julio Jones", "WR", 17], ["DeAndre Hopkins", "WR", 18],
  ["Aaron Jones", "RB", 19], ["Travis Kelce", "TE", 20], ["Patrick Mahomes", "QB", 21],
  ["Chris Godwin", "WR", 22], ["Lamar Jackson", "QB", 23], ["George Kittle", "TE", 24],
  ["Kenny Golladay", "WR", 25], ["Mike Evans", "WR", 26], ["Chris Carson", "RB", 27],
  ["DJ Moore", "WR", 28], ["Todd Gurley", "RB", 29], ["Allen Robinson", "WR", 30],
  ["Odell Beckham Jr.", "WR", 31], ["Adam Thielen", "WR", 32], ["JuJu Smith-Schuster", "WR", 33],
  ["James Conner", "RB", 34], ["Amari Cooper", "WR", 35], ["David Johnson", "RB", 36],
  ["Le'Veon Bell", "RB", 37], ["Cooper Kupp", "WR", 38], ["Melvin Gordon", "RB", 39],
  ["Zach Ertz", "TE", 40], ["Mark Andrews", "TE", 41], ["A.J. Brown", "WR", 42],
  ["Jonathan Taylor", "RB", 43], ["Calvin Ridley", "WR", 44], ["Robert Woods", "WR", 45],
  ["Courtland Sutton", "WR", 46], ["Keenan Allen", "WR", 47], ["Tyler Lockett", "WR", 48],
  ["DK Metcalf", "WR", 49], ["Devin Singletary", "RB", 50], ["Dak Prescott", "QB", 51],
  ["DJ Chark", "WR", 52], ["Raheem Mostert", "RB", 53], ["Cam Akers", "RB", 54],
  ["Mark Ingram", "RB", 55], ["Terry McLaurin", "WR", 56], ["T.Y. Hilton", "WR", 57],
  ["Darren Waller", "TE", 58], ["Kareem Hunt", "RB", 59], ["Kyler Murray", "QB", 60],
  ["Deshaun Watson", "QB", 61], ["Leonard Fournette", "RB", 62], ["Russell Wilson", "QB", 63],
  ["DeVante Parker", "WR", 64], ["Stefon Diggs", "WR", 65], ["David Montgomery", "RB", 66],
  ["D'Andre Swift", "RB", 67], ["Hollywood Brown", "WR", 68], ["A.J. Green", "WR", 69],
  ["Jarvis Landry", "WR", 70], ["Evan Engram", "TE", 71], ["Tyler Boyd", "WR", 72],
  ["Michael Gallup", "WR", 73], ["Will Fuller", "WR", 74], ["Julian Edelman", "WR", 75],
  ["Rob Gronkowski", "TE", 76], ["James White", "RB", 77], ["Tom Brady", "QB", 78],
  ["Tyler Higbee", "TE", 79], ["Drew Brees", "QB", 80], ["Matt Ryan", "QB", 81],
  ["Deebo Samuel", "WR", 82], ["J.K. Dobbins", "RB", 83], ["Hunter Henry", "TE", 84],
  ["Tarik Cohen", "RB", 85], ["Brandin Cooks", "WR", 86], ["Ronald Jones", "RB", 87],
  ["Phillip Lindsay", "RB", 88], ["Marvin Jones", "WR", 89], ["Jordan Howard", "RB", 90],
  ["Josh Allen", "QB", 91], ["Aaron Rodgers", "QB", 92], ["Marlon Mack", "RB", 93],
  ["Kerryon Johnson", "RB", 94], ["Matt Breida", "RB", 95], ["Diontae Johnson", "WR", 96],
  ["Antonio Gibson", "RB", 97], ["Christian Kirk", "WR", 98], ["Zack Moss", "RB", 99],
  ["CeeDee Lamb", "WR", 100], ["Jamison Crowder", "WR", 101], ["Carson Wentz", "QB", 102],
  ["Jared Cook", "TE", 103], ["Sterling Shepard", "WR", 104], ["Hayden Hurst", "TE", 105],
  ["Emmanuel Sanders", "WR", 106], ["San Francisco 49ers", "DST", 107], ["Latavius Murray", "RB", 108],
  ["Matthew Stafford", "QB", 109], ["Sony Michel", "RB", 110], ["Tevin Coleman", "RB", 111],
  ["Jerry Jeudy", "WR", 112], ["Darius Slayton", "WR", 113], ["Noah Fant", "TE", 114],
  ["Pittsburgh Steelers", "DST", 115], ["Henry Ruggs III", "WR", 116], ["John Brown", "WR", 117],
  ["Alexander Mattison", "RB", 118], ["Austin Hooper", "TE", 119], ["Baltimore Ravens", "DST", 120],
];

// 2021-22 ADP — Top 120 (CMC #1)
const ADP_2021: AdpEntry[] = [
  ["Christian McCaffrey", "RB", 1], ["Dalvin Cook", "RB", 2], ["Alvin Kamara", "RB", 3],
  ["Derrick Henry", "RB", 4], ["Ezekiel Elliott", "RB", 5], ["Davante Adams", "WR", 6],
  ["Travis Kelce", "TE", 7], ["Aaron Jones", "RB", 8], ["Saquon Barkley", "RB", 9],
  ["Austin Ekeler", "RB", 10], ["Jonathan Taylor", "RB", 11], ["Nick Chubb", "RB", 12],
  ["Tyreek Hill", "WR", 13], ["Stefon Diggs", "WR", 14], ["Najee Harris", "RB", 15],
  ["DeAndre Hopkins", "WR", 16], ["Antonio Gibson", "RB", 17], ["Patrick Mahomes", "QB", 18],
  ["Calvin Ridley", "WR", 19], ["DK Metcalf", "WR", 20], ["Joe Mixon", "RB", 21],
  ["Darren Waller", "TE", 22], ["Justin Jefferson", "WR", 23], ["A.J. Brown", "WR", 24],
  ["Clyde Edwards-Helaire", "RB", 25], ["George Kittle", "TE", 26], ["Keenan Allen", "WR", 27],
  ["Terry McLaurin", "WR", 28], ["Josh Allen", "QB", 29], ["David Montgomery", "RB", 30],
  ["Allen Robinson", "WR", 31], ["Chris Carson", "RB", 32], ["CeeDee Lamb", "WR", 33],
  ["James Robinson", "RB", 34], ["Mike Evans", "WR", 35], ["Josh Jacobs", "RB", 36],
  ["D'Andre Swift", "RB", 37], ["Miles Sanders", "RB", 38], ["Robert Woods", "WR", 39],
  ["Kyler Murray", "QB", 40], ["Amari Cooper", "WR", 41], ["Chris Godwin", "WR", 42],
  ["Lamar Jackson", "QB", 43], ["Cooper Kupp", "WR", 44], ["Julio Jones", "WR", 45],
  ["Kyle Pitts", "TE", 46], ["Tyler Lockett", "WR", 47], ["Myles Gaskin", "RB", 48],
  ["Mark Andrews", "TE", 49], ["Adam Thielen", "WR", 50], ["Diontae Johnson", "WR", 51],
  ["DJ Moore", "WR", 52], ["Aaron Rodgers", "QB", 53], ["Russell Wilson", "QB", 54],
  ["Dak Prescott", "QB", 55], ["Mike Davis", "RB", 56], ["Kareem Hunt", "RB", 57],
  ["T.J. Hockenson", "TE", 58], ["Darrell Henderson", "RB", 59], ["Javonte Williams", "RB", 60],
  ["Brandon Aiyuk", "WR", 61], ["Chase Edmonds", "RB", 62], ["Justin Herbert", "QB", 63],
  ["Tee Higgins", "WR", 64], ["Odell Beckham Jr.", "WR", 65], ["Raheem Mostert", "RB", 66],
  ["Chase Claypool", "WR", 67], ["JuJu Smith-Schuster", "WR", 68], ["Tom Brady", "QB", 69],
  ["Damien Harris", "RB", 70], ["Jerry Jeudy", "WR", 71], ["Ja'Marr Chase", "WR", 72],
  ["Kenny Golladay", "WR", 73], ["DeVonta Smith", "WR", 74], ["Robby Anderson", "WR", 75],
  ["Michael Thomas", "WR", 76], ["Courtland Sutton", "WR", 77], ["Melvin Gordon", "RB", 78],
  ["Logan Thomas", "TE", 79], ["Noah Fant", "TE", 80], ["Leonard Fournette", "RB", 81],
  ["Trey Sermon", "RB", 82], ["Deebo Samuel", "WR", 83], ["Matthew Stafford", "QB", 84],
  ["Robert Tonyan", "TE", 85], ["Tyler Boyd", "WR", 86], ["Ronald Jones", "RB", 87],
  ["Laviska Shenault", "WR", 88], ["Brandin Cooks", "WR", 89], ["Michael Carter", "RB", 90],
  ["Ryan Tannehill", "QB", 91], ["Antonio Brown", "WR", 92], ["Corey Davis", "WR", 93],
  ["Jalen Hurts", "QB", 94], ["Dallas Goedert", "TE", 95], ["James Conner", "RB", 96],
  ["DJ Chark", "WR", 97], ["Jarvis Landry", "WR", 98], ["Tampa Bay Buccaneers", "DST", 99],
  ["AJ Dillon", "RB", 100], ["Michael Pittman", "WR", 101], ["Kenyan Drake", "RB", 102],
  ["Zack Moss", "RB", 103], ["Jaylen Waddle", "WR", 104], ["Los Angeles Rams", "DST", 105],
  ["Will Fuller", "WR", 106], ["Mike Gesicki", "TE", 107], ["Pittsburgh Steelers", "DST", 108],
  ["Joe Burrow", "QB", 109], ["Tyler Higbee", "TE", 110], ["Devin Singletary", "RB", 111],
  ["Jamaal Williams", "RB", 112], ["Sony Michel", "RB", 113], ["Michael Gallup", "WR", 114],
  ["Curtis Samuel", "WR", 115], ["Washington Commanders", "DST", 116], ["Marvin Jones", "WR", 117],
  ["Marquez Callaway", "WR", 118], ["Mike Williams", "WR", 119], ["Jonnu Smith", "TE", 120],
];

// 2022-23 ADP — Top 120 (Jonathan Taylor #1)
const ADP_2022: AdpEntry[] = [
  ["Jonathan Taylor", "RB", 1], ["Christian McCaffrey", "RB", 2], ["Austin Ekeler", "RB", 3],
  ["Cooper Kupp", "WR", 4], ["Derrick Henry", "RB", 5], ["Justin Jefferson", "WR", 6],
  ["Dalvin Cook", "RB", 7], ["Najee Harris", "RB", 8], ["Ja'Marr Chase", "WR", 9],
  ["Joe Mixon", "RB", 10], ["Davante Adams", "WR", 11], ["Stefon Diggs", "WR", 12],
  ["Alvin Kamara", "RB", 13], ["Travis Kelce", "TE", 14], ["D'Andre Swift", "RB", 15],
  ["Deebo Samuel", "WR", 16], ["Aaron Jones", "RB", 17], ["CeeDee Lamb", "WR", 18],
  ["Tyreek Hill", "WR", 19], ["Nick Chubb", "RB", 20], ["Saquon Barkley", "RB", 21],
  ["Josh Allen", "QB", 22], ["Mark Andrews", "TE", 23], ["Leonard Fournette", "RB", 24],
  ["Javonte Williams", "RB", 25], ["Mike Evans", "WR", 26], ["Keenan Allen", "WR", 27],
  ["James Conner", "RB", 28], ["Patrick Mahomes", "QB", 29], ["Ezekiel Elliott", "RB", 30],
  ["A.J. Brown", "WR", 31], ["Kyle Pitts", "TE", 32], ["Michael Pittman", "WR", 33],
  ["Tee Higgins", "WR", 34], ["Justin Herbert", "QB", 35], ["David Montgomery", "RB", 36],
  ["Cam Akers", "RB", 37], ["George Kittle", "TE", 38], ["Travis Etienne", "RB", 39],
  ["Terry McLaurin", "WR", 40], ["Lamar Jackson", "QB", 41], ["DJ Moore", "WR", 42],
  ["Diontae Johnson", "WR", 43], ["Darren Waller", "TE", 44], ["Mike Williams", "WR", 45],
  ["Jaylen Waddle", "WR", 46], ["DK Metcalf", "WR", 47], ["Josh Jacobs", "RB", 48],
  ["Elijah Mitchell", "RB", 49], ["J.K. Dobbins", "RB", 50], ["Breece Hall", "RB", 51],
  ["Kyler Murray", "QB", 52], ["Jalen Hurts", "QB", 53], ["Brandin Cooks", "WR", 54],
  ["Dalton Schultz", "TE", 55], ["Courtland Sutton", "WR", 56], ["Joe Burrow", "QB", 57],
  ["Hollywood Brown", "WR", 58], ["Chris Godwin", "WR", 59], ["Allen Robinson", "WR", 60],
  ["Amon-Ra St. Brown", "WR", 61], ["Clyde Edwards-Helaire", "RB", 62], ["Antonio Gibson", "RB", 63],
  ["Jerry Jeudy", "WR", 64], ["T.J. Hockenson", "TE", 65], ["Gabe Davis", "WR", 66],
  ["AJ Dillon", "RB", 67], ["Amari Cooper", "WR", 68], ["Dallas Goedert", "TE", 69],
  ["Tom Brady", "QB", 70], ["Adam Thielen", "WR", 71], ["Darnell Mooney", "WR", 72],
  ["JuJu Smith-Schuster", "WR", 73], ["Russell Wilson", "QB", 74], ["Michael Thomas", "WR", 75],
  ["Aaron Rodgers", "QB", 76], ["Dak Prescott", "QB", 77], ["Devin Singletary", "RB", 78],
  ["Hunter Renfrow", "WR", 79], ["DeAndre Hopkins", "WR", 80], ["Dameon Pierce", "RB", 81],
  ["Damien Harris", "RB", 82], ["Miles Sanders", "RB", 83], ["Kareem Hunt", "RB", 84],
  ["Cordarrelle Patterson", "RB", 85], ["Tony Pollard", "RB", 86], ["Chase Edmonds", "RB", 87],
  ["Rashaad Penny", "RB", 88], ["Rashod Bateman", "WR", 89], ["Zach Ertz", "TE", 90],
  ["Dawson Knox", "TE", 91], ["Elijah Moore", "WR", 92], ["DeVonta Smith", "WR", 93],
  ["Buffalo Bills", "DST", 94], ["Matthew Stafford", "QB", 95], ["Tyler Lockett", "WR", 96],
  ["Brandon Aiyuk", "WR", 97], ["Drake London", "WR", 98], ["Rhamondre Stevenson", "RB", 99],
  ["Christian Kirk", "WR", 100], ["Trey Lance", "QB", 101], ["Robert Woods", "WR", 102],
  ["Allen Lazard", "WR", 103], ["Justin Tucker", "K", 104], ["Melvin Gordon", "RB", 105],
  ["Pat Freiermuth", "TE", 106], ["Chris Olave", "WR", 107], ["Tampa Bay Buccaneers", "DST", 108],
  ["Derek Carr", "QB", 109], ["Kenneth Walker III", "RB", 110], ["Chase Claypool", "WR", 111],
  ["James Robinson", "RB", 112], ["Michael Carter", "RB", 113], ["San Francisco 49ers", "DST", 114],
  ["Kadarius Toney", "WR", 115], ["James Cook", "RB", 116], ["Cole Kmet", "TE", 117],
  ["Indianapolis Colts", "DST", 118], ["Kirk Cousins", "QB", 119], ["George Pickens", "WR", 120],
];

// 2023-24 ADP — Top 120 (Justin Jefferson #1)
const ADP_2023: AdpEntry[] = [
  ["Justin Jefferson", "WR", 1], ["Christian McCaffrey", "RB", 2], ["Ja'Marr Chase", "WR", 3],
  ["Austin Ekeler", "RB", 4], ["Travis Kelce", "TE", 5], ["Tyreek Hill", "WR", 6],
  ["Saquon Barkley", "RB", 7], ["Bijan Robinson", "RB", 8], ["Stefon Diggs", "WR", 9],
  ["Nick Chubb", "RB", 10], ["Davante Adams", "WR", 11], ["CeeDee Lamb", "WR", 12],
  ["Cooper Kupp", "WR", 13], ["Patrick Mahomes", "QB", 14], ["A.J. Brown", "WR", 15],
  ["Tony Pollard", "RB", 16], ["Derrick Henry", "RB", 17], ["Josh Jacobs", "RB", 18],
  ["Garrett Wilson", "WR", 19], ["Amon-Ra St. Brown", "WR", 20], ["Josh Allen", "QB", 21],
  ["Jalen Hurts", "QB", 22], ["Jaylen Waddle", "WR", 23], ["Chris Olave", "WR", 24],
  ["DeVonta Smith", "WR", 25], ["Najee Harris", "RB", 26], ["Tee Higgins", "WR", 27],
  ["Travis Etienne", "RB", 28], ["Mark Andrews", "TE", 29], ["Rhamondre Stevenson", "RB", 30],
  ["DK Metcalf", "WR", 31], ["Joe Mixon", "RB", 32], ["Jahmyr Gibbs", "RB", 33],
  ["Lamar Jackson", "QB", 34], ["Calvin Ridley", "WR", 35], ["Joe Burrow", "QB", 36],
  ["Aaron Jones", "RB", 37], ["Deebo Samuel", "WR", 38], ["Breece Hall", "RB", 39],
  ["Amari Cooper", "WR", 40], ["Keenan Allen", "WR", 41], ["Justin Herbert", "QB", 42],
  ["Kenneth Walker III", "RB", 43], ["Justin Fields", "QB", 44], ["T.J. Hockenson", "TE", 45],
  ["Dameon Pierce", "RB", 46], ["Jonathan Taylor", "RB", 47], ["George Kittle", "TE", 48],
  ["Miles Sanders", "RB", 49], ["Darren Waller", "TE", 50], ["DJ Moore", "WR", 51],
  ["DeAndre Hopkins", "WR", 52], ["Terry McLaurin", "WR", 53], ["Trevor Lawrence", "QB", 54],
  ["Christian Watson", "WR", 55], ["Mike Williams", "WR", 56], ["Alvin Kamara", "RB", 57],
  ["Kyle Pitts", "TE", 58], ["Alexander Mattison", "RB", 59], ["Dalvin Cook", "RB", 60],
  ["Dallas Goedert", "TE", 61], ["Cam Akers", "RB", 62], ["James Conner", "RB", 63],
  ["Rachaad White", "RB", 64], ["Drake London", "WR", 65], ["Chris Godwin", "WR", 66],
  ["Tyler Lockett", "WR", 67], ["James Cook", "RB", 68], ["Jerry Jeudy", "WR", 69],
  ["Brandon Aiyuk", "WR", 70], ["Isiah Pacheco", "RB", 71], ["Javonte Williams", "RB", 72],
  ["D'Andre Swift", "RB", 73], ["Diontae Johnson", "WR", 74], ["Mike Evans", "WR", 75],
  ["Deshaun Watson", "QB", 76], ["Christian Kirk", "WR", 77], ["Evan Engram", "TE", 78],
  ["Michael Pittman", "WR", 79], ["San Francisco 49ers", "DST", 80], ["George Pickens", "WR", 81],
  ["David Njoku", "TE", 82], ["David Montgomery", "RB", 83], ["Dak Prescott", "QB", 84],
  ["Justin Tucker", "K", 85], ["Hollywood Brown", "WR", 86], ["Jahan Dotson", "WR", 87],
  ["Tua Tagovailoa", "QB", 88], ["Jordan Addison", "WR", 89], ["AJ Dillon", "RB", 90],
  ["Brandin Cooks", "WR", 91], ["Pat Freiermuth", "TE", 92], ["Jaxon Smith-Njigba", "WR", 93],
  ["Khalil Herbert", "RB", 94], ["Aaron Rodgers", "QB", 95], ["Jamaal Williams", "RB", 96],
  ["Philadelphia Eagles", "DST", 97], ["Courtland Sutton", "WR", 98], ["Michael Thomas", "WR", 99],
  ["Odell Beckham Jr.", "WR", 100], ["Gabe Davis", "WR", 101], ["Buffalo Bills", "DST", 102],
  ["Brian Robinson Jr.", "RB", 103], ["JuJu Smith-Schuster", "WR", 104], ["Kirk Cousins", "QB", 105],
  ["Antonio Gibson", "RB", 106], ["Treylon Burks", "WR", 107], ["Daniel Carlson", "K", 108],
  ["Zay Flowers", "WR", 109], ["Kadarius Toney", "WR", 110], ["Zach Charbonnet", "RB", 111],
  ["Dallas Cowboys", "DST", 112], ["Samaje Perine", "RB", 113], ["Anthony Richardson", "QB", 114],
  ["Dalton Schultz", "TE", 115], ["Daniel Jones", "QB", 116], ["New York Jets", "DST", 117],
  ["Geno Smith", "QB", 118], ["Quentin Johnston", "WR", 119], ["Jerick McKinnon", "RB", 120],
];

const ALL_SEASONS: { season: string; data: AdpEntry[] }[] = [
  { season: "2019-20", data: ADP_2019 },
  { season: "2020-21", data: ADP_2020 },
  { season: "2021-22", data: ADP_2021 },
  { season: "2022-23", data: ADP_2022 },
  { season: "2023-24", data: ADP_2023 },
];

export default api({
  name: "SeedHistoricalAdpV2",
  description: "Seeds historical ADP data for 2019-20 through 2023-24 seasons.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
    totalInserted: z.number(),
  }),

  async run(ctx) {
    const seasons = ALL_SEASONS.map(s => s.season);

    // Clear existing ADP data for these seasons
    await ctx.integrations.apps_db.execute(
      `DELETE FROM ffwr_historical_adp WHERE season = ANY($1::text[])`,
      [seasons],
      { label: "Clear existing historical ADP data" }
    );

    let totalInserted = 0;
    const batchSize = 30;

    for (const { season, data } of ALL_SEASONS) {
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const values = batch
          .map((_, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`)
          .join(", ");
        const params = batch.flatMap(([name, pos, rank]) => [season, name, pos, rank]);

        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_historical_adp (season, player_name, position, adp_rank) VALUES ${values}`,
          params,
          { label: `Insert ${season} ADP batch ${Math.floor(i / batchSize) + 1}` }
        );

        totalInserted += batch.length;
      }
    }

    return {
      message: `Seeded ${totalInserted} ADP entries across ${ALL_SEASONS.length} seasons (2019-20 through 2023-24).`,
      totalInserted,
    };
  },
});
