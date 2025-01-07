import os

import urllib.parse

# Define the folder path
folder_path = (
    "/Users/failip/code/uni/autograph_new/autograph_github/static/graphs/isooctane/"
)

# # Iterate over all files in the folder
for filename in os.listdir(folder_path):
    if filename.endswith(".xyz"):
        # Create the full file path
        old_file_path = os.path.join(folder_path, filename)

        # Generate the new file name
        new_filename = urllib.parse.quote(filename, safe="()=[]")
        new_file_path = os.path.join(folder_path, new_filename)

        # Rename the file
        os.rename(old_file_path, new_file_path)
        print(f"Renamed: {old_file_path} to {new_file_path}")
