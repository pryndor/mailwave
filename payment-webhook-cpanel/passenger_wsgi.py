# cPanel's "Setup Python App" (Passenger) looks for this exact file and
# an "application" WSGI callable in it. Flask's app object already is one.
from app import app as application
