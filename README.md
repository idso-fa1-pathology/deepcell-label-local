# DeepCell Label: Cloud-Based Labeling for Single-Cell Analysis

[![Build Status](https://github.com/vanvalenlab/deepcell-label/workflows/tests/badge.svg)](https://github.com/vanvalenlab/deepcell-label/actions)
[![Coverage Status](https://coveralls.io/repos/github/vanvalenlab/deepcell-label/badge.svg?branch=main)](https://coveralls.io/github/vanvalenlab/deepcell-label?branch=main)
[![Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/vanvalenlab/deepcell-label/blob/main/LICENSE)

DeepCell Label is a web-based tool to visualize and label biological images. It can segment an image, assign cells across a timelapse, and track divisions in multiplexed images, 3D image stacks, and time-lapse movies.
###locally
As it's available through a browser, DeepCell Label can crowdsource data labeling or review, correct, and curate labels as a domain expert.

The site is built with [React](https://reactjs.org/), [XState](https://xstate.js.org/docs/), and [Flask](https://flask.palletsprojects.com/en/2.0.x/) and [runs locally](/documentation/LOCAL_USE.md) or [on the cloud](/documentation/DEPLOYMENT.md).

Visit [label.deepcell.org](https://label.deepcell.org) to create a project from an example file or your own .tiff, .png, or .npz. Dropdown instructions are available while working on a project in DeepCell Label.

## New Modification in `blueprints.py` File

### Location
`backend/deepcell/`

### Changes
The `create_project` function has been updated in the `@bp.route('/api/project', methods=['POST'])` to handle project creation via URL inputs for images and optionally labels. Here's the updated function:

```python
@bp.route('/api/project/<project_id>', methods=['GET'])
def get_project(project_id):
    start = timeit.default_timer()
    project = Project.get(project_id)
    if not project:
        return abort(404, description=f'Project {project_id} not found')
    file_path = os.path.join('/rsrch5/home/plm/yshokrollahi/project4/apps/deepcell-label/backend', f'{project_id}.zip')  # Local path for files
    if os.path.exists(file_path):
        return send_file(
            file_path,
            mimetype='application/zip',
            as_attachment=True,
            attachment_filename=f'{project_id}.zip'
        )
    else:
        return abort(404, description='File not found')


@bp.route('/api/project', methods=['POST'])
def create_project():
    """
    Create a new Project from URL.
    """
    start = timeit.default_timer()
    if 'images' in request.form:
        images_url = request.form['images']
    else:
        return abort(
            400,
            description='Include "images" in the request form with a URL to download the project data.',
        )
    labels_url = request.form['labels'] if 'labels' in request.form else None
    axes = request.form['axes'] if 'axes' in request.form else None
    with tempfile.NamedTemporaryFile(
        delete=DELETE_TEMP
    ) as image_file, tempfile.NamedTemporaryFile(delete=DELETE_TEMP) as label_file:
        if images_url is not None:
            image_response = requests.get(images_url)
            if image_response.status_code != 200:
                return (
                    image_response.text,
                    image_response.status_code,
                    image_response.headers.items(),
                )
            image_file.write(image_response.content)
            image_file.seek(0)
        if labels_url is not None:
            labels_response = requests.get(labels_url)
            if labels_response.status_code != 200:
                return (
                    labels_response.text,
                    labels_response.status_code,
                    labels_response.headers.items(),
                )
            label_file.write(labels_response.content)
            label_file.seek(0)
        else:
            label_file = image_file
        loader = Loader(image_file, label_file, axes)
        project = Project.create(loader)
    if not DELETE_TEMP:
        image_file.close()
        label_file.close()
        os.remove(image_file.name)  # Manually close and delete if using Windows
    current_app.logger.info(
        'Created project %s from %s in %s s.',
        project.project,
        f'{images_url}' if labels_url is None else f'{images_url} and {labels_url}',
        timeit.default_timer() - start,
    )
    return jsonify(project.project)

```

## New Modification in `model.py` File

### Location
`backend/deepcell/`

### Changes
The `Project` class within the `model.py` has been updated to handle project creation and data management using SQLAlchemy. The detailed modifications are as follows:

```python
"""SQL Alchemy database models."""
from __future__ import absolute_import, division, print_function

import io
import logging
import timeit
from secrets import token_urlsafe

import boto3
from flask_sqlalchemy import SQLAlchemy

from deepcell_label.config import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET

logger = logging.getLogger('models.Project')  # pylint: disable=C0103
db = SQLAlchemy()  # pylint: disable=C0103


import os

db = SQLAlchemy()

class Project(db.Model):
    """Project table definition."""
    __tablename__ = 'projects'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    project = db.Column(db.String(12), unique=True, nullable=False, index=True)
    createdAt = db.Column(db.TIMESTAMP, nullable=False, default=db.func.now())
    # bucket and key columns can be repurposed or removed if not needed
    bucket = db.Column(db.Text, nullable=True)
    key = db.Column(db.Text, nullable=True)

    def __init__(self, loader):
        """
        Initialize a new project with data from a loader.

        Args:
            loader: Loaders.Loader object containing the project data.
        """
        start = timeit.default_timer()

        # Create a unique 12 character base64 project ID
        while True:
            project_id = token_urlsafe(9)  # 9 bytes is 12 base64 characters
            if not db.session.query(Project).filter_by(project=project_id).first():
                self.project = project_id
                break

        # Define local storage path
        local_storage_path = '/rsrch5/home/plm/yshokrollahi/project4/apps/deepcell-label/backend'
        self.key = f'{self.project}.zip'  # Use project ID for the filename
        file_path = os.path.join(local_storage_path, self.key)

        # Setting a default value for bucket, even if it's not being used
        self.bucket = "local"

        # Write the project data to a file at the specified path
        with open(file_path, 'wb') as file:
            file.write(loader.data)

        logger.debug(
            'Initialized project %s and saved locally to %s in %ss.',
            self.project,
            file_path,
            timeit.default_timer() - start,
        )

    @staticmethod
    def get(project):
        """
        Return the project with the given ID, if it exists.

        Args:
            project (int): unique 12 character base64 string to identify project

        Returns:
            Project: row from the Project table
        """
        start = timeit.default_timer()
        project = db.session.query(Project).filter_by(project=project).first()
        logger.debug('Got project %s in %ss.', project, timeit.default_timer() - start)
        return project

    @staticmethod
    def create(data):
        """
        Create a new project in the Project table.

        Args:
            data: zip file with loaded project data

        Returns:
            Project: new row in the Project table
        """
        start = timeit.default_timer()
        project = Project(data)
        db.session.add(project)
        db.session.commit()
        logger.debug(
            'Created new project %s in %ss.',
            project.project,
            timeit.default_timer() - start,
        )
        return project

