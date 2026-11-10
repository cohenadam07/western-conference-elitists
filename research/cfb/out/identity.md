# Identity (BUILD step 5)

- Players on a roster or with a stat, 2009 to 2026: 132,493; with a stat in an FBS game: 47,947.
- Player-seasons moved to the team they recorded stats for (the roster file had them elsewhere): 909. Player-seasons with stats and no roster row: 2,162.
- Recruits joined: 39,984 of 59,438 rated high-school recruits in CFBD's 2010 to 2026 classes. By method: espn id 28,630; name + school + class year 11,147; roster file's CFBD id 207.
- ESPN-id joins refused because neither the surname nor the school agreed: 0 (listed in the Mac's work folder).
- Share of FBS players with a stat who have a recruit record, by season: 2009 0%, 2010 8%, 2011 22%, 2012 37%, 2014 58%, 2015 58%, 2016 60%, 2017 63%, 2018 67%, 2019 70%, 2020 74%, 2021 73%, 2022 73%, 2023 71%, 2024 69%, 2025 68%, 2026 69%.
- Transfers seen as a change of team between a player's seasons: 7,862. Portal rows (2021 on): 18,906, 13,733 with a destination in our team table, 11,596 joined to a player by name, destination and season.
- NFL: 5,727 players linked to a Football Savant id (11,941 ids on Football Savant). By method: espn id 3,306; name + college + rookie year 2,421.
- Head coaches: 1,840 coach-seasons for 1,706 team-seasons; 132 team-seasons had more than one.
- Hand fixes applied from pipeline/cfb/manual/id_fixes.csv: 0.

Class check on 2026, the one season ESPN's class label is current (13,795 players): the derived freshman flag agrees with ESPN's for 85.8%; the derived class is within one year of ESPN's for 93.3%. 2026 uses ESPN's label; earlier seasons use the derived one.

## Team talent: the forms tried against CFBD's 2024 table

| rating floor | players counted | Pearson r | rank correlation | teams |
|---:|---|---:|---:|---:|
| 0.80 | 85 | 0.923 | 0.989 | 134 |
| 0.80 | all | 0.922 | 0.989 | 134 |
| 0.75 | 85 | 0.938 | 0.979 | 134 |
| 0.75 | all | 0.934 | 0.977 | 134 |
| 0.70 | 85 | 0.935 | 0.966 | 134 |
| 0.70 | all | 0.929 | 0.964 | 134 |
| 0.00 | 85 | 0.859 | 0.894 | 134 |
| 0.00 | all | 0.851 | 0.885 | 134 |

Used: the first row. Top five of 2026: Georgia, Notre Dame, Texas, Ohio State, Texas A&M.
